// GDShader Preprocessor

type Other = { [_: string]: undefined; };

export interface PreprocessingFile { uri: string; code: string; }

export interface CodePosition {
  /** The 1-based line position. */
  line: number;
  /** The 0-based character position in the line. */
  column: number;
}
export interface CodeRange {
  /** The start position. */
  start: CodePosition;
  /** The end position. */
  end: CodePosition;
}
interface CodeLocation extends CodeRange {
  /** The URI of the source. */
  uri: string;
}
interface PreprocessorToken extends CodeRange {
  /** The preprocessed token text. */
  code: string;
}
type TokenString = string | PreprocessorToken;
export interface PreprocessorDiagnostic {
  /** A code for the type of error. */
  id: '' | keyof typeof preprocessorErrorTypes;
  /** The error message. */
  msg: string;
  /** Target location in code. */
  location: CodeLocation;
  /** Trace of causes until the original source at the end of the list. */
  cause?: PreprocessorDiagnostic;
}

interface MacroReplacementDefinition {
  parameters: null | string[];
  code: string;
}
interface MacroExpansion {
  identifier: PreprocessorToken;
  definition: MacroReplacementDefinition;
  arguments: null | string[];
}

export interface MappedLocation {
  unit: PreprocessedUnit;
  inputPosition: number;
  inputLength: number;
  chunkIndex: number;
  replacement?: PreprocessedOutput;
  original?: MappedLocation;
}
interface PreprocessedChunk {
  inputCode: string;
  replacement?: PreprocessedOutput;
}
interface PreprocessedOutput {
  code: string;
  construct: PreprocessorConstruct;
}

export class PreprocessedUnit {
  readonly input: PreprocessingFile;
  readonly chunks: PreprocessedChunk[] = [];
  /** Errors during preprocessing are added here. */
  readonly diagnostics: PreprocessorDiagnostic[] = [];
  constructor(input: PreprocessingFile, chunks: PreprocessedChunk[], diagnostics: PreprocessorDiagnostic[]) {
    this.input = input;
    this.chunks = chunks;
    this.diagnostics = diagnostics;
    this.preprocessedCode = chunks.map(c => c.replacement?.code ?? c.inputCode).join('');
    this.preprocessedLines = splitLines(this.preprocessedCode);
    this.inputLines = splitLines(input.code);
  }
  /** Joint chunk outputs with the full preprocessed code. */
  readonly preprocessedCode: string;
  /** The full preprocessed code split by lines, including newline chars. */
  readonly preprocessedLines: string[];
  /** The full input code split by lines, including newline chars. */
  readonly inputLines: string[];
  /** Map a position in the output code to its equivalent in the input entry code.
   * This is used to convert diagnostic positions in the preprocessed unit to the original source code.
   * @param outputPosition The UTF-16 char offset in the output code to be mapped.
   * @returns The UTF-16 char range in the input code and chunk index to optionally get more context.
   */
  sourcemap(outputPosition: number): MappedLocation {
    let inputPosition = 0, i = 0, chunk;
    for (chunk of this.chunks) {
      const outputCode = chunk.replacement?.code ?? chunk.inputCode;
      const chunkOutputLength = outputCode.length;
      if (outputPosition < chunkOutputLength) break;
      outputPosition -= chunkOutputLength;
      inputPosition += chunk.inputCode.length;
      i++;
    }
    if (!chunk || !chunk.replacement)
      return { unit: this, inputPosition: inputPosition + outputPosition, inputLength: 0, chunkIndex: i };
    const replacement = chunk.replacement;
    const construct = chunk.replacement.construct;
    const unit = (construct as PreprocessorInclude | Other).unit;
    const original = unit?.sourcemap(outputPosition);
    return { unit: this, inputPosition, inputLength: chunk.inputCode.length, chunkIndex: i, replacement, original };
  }
  outputOffsetAt(line: number, column: number) {
    return offsetAt(this.preprocessedLines, line, column);
  }
  inputPositionAt(offset: number): CodePosition {
    return positionAt(this.inputLines, offset);
  }
}

/** Split code by lines, including line terminators. The result always has at least 1 line.
 * @param code Input code.
 * @returns List of lines including terminators. The last line without a terminator is always included even if empty.
 */
function splitLines(code: string): string[] {
  const lines: string[] = [];
  let i0 = 0;
  for (let i = 0, n = code.length; i < n;) {
    const c = code[i++];
    if (c == '\n' || c == '\r' && code[i] != '\n') { lines.push(code.substring(i0, i)); i0 = i; }
  }
  lines.push(code.substring(i0));
  return lines;
}
/** Get the char offset position from line and column numbers.
 * @param lines List of lines including terminators.
 * @param line The 1-based line position.
 * @param column The 0-based character position in the line.
 * @returns The UTF-16 char offset index.
 */
function offsetAt(lines: string[], line: number, column: number) {
  if (line > lines.length) return -1;
  let b = 0, i = 0;
  for (const l = line - 1; i < l; i++) b += lines[i]!.length;
  return b + column;
}
/**
 * Get the line and column numbers from the char offset position.
 * @param lines List of lines including terminators.
 * @param offset The UTF-16 char offset index.
 * @returns The line and column position.
 */
function positionAt(lines: string[], offset: number): CodePosition {
  let i = 0;
  for (const n = lines.length - 1; i < n; i++) {
    const { length } = lines[i]!;
    if (offset < length) break;
    offset -= length;
  }
  return { line: i + 1, column: offset };
}

function countString(code: string, i: number): number {
  const i0 = i;
  let c = code.substring(i, i + 2);
  while (c && !/^["\n\r]/.test(c)) { // newlines are not allowed at all, escaped or not
    if (/^\\[\n\r]/.test(c)) return ~(i - i0); // return negative for line continuation, without counting backslash
    if (/^\\[\\"]$/.test(c)) i++; // allows escaping backslash and double quote
    i++; c = code.substring(i, i + 2);
  }
  if (c[0] == '"') i++;
  return i - i0;
}

function columnOfPreviousTokenInLine(code: string, i: number, column: number): number {
  let inBlockComment = false;
  for (--i; --column >= 0; --i) {
    const c = code[i];
    if (inBlockComment) { if (c == '*' && code[i - 1] == '/') { --i; --column; inBlockComment = false; } }
    else if (c == '/' && code[i - 1] == '*') { --i; --column; inBlockComment = true; }
    else if (c != ' ' && c != '\t') return column; // column position of invalid uncommented char
  }
  return -1; // no previous non-whitespace token in this line outside of comments
}

function commentOut(code: string) {
  return '//' + code.replace(/\n|\r\n?/g, '$&//');
}

/** Implementation for a Godot Shader Preprocessor that is suitable for IDEs.
 * Construct a new instance every time preprocessing is executed.
 */
export default abstract class GDShaderPreprocessorBase {
  /** Implement this to make `#include` directives load a file from its path.
   *
   * It should be able to resolve `res://` paths always;
   * as well as relative paths from non-embedded files (i.e. when `fromUri` is not empty).
   * @param loadPath The string after the `#include` directive, with `\` already replaced with `/`.
   * @param fromUri The URI of the file containing the `#include` directive.
   * @returns The resolved URI of the loaded file and its code to be additionally preprocessed.
   * @throws {string | Error} Used as an error diagnostic message on the directive without aborting the preprocessor.
   */
  abstract loader(loadPath: string, fromUri: string): Promise<PreprocessingFile>;
  /** Initial macro definitions will be updated during preprocessing. It maps macros from a set of identifiers.
   * Occurrences of identifier `parameters` on `code` will be replaced upon expansion.
   */
  macros: Map<string, MacroReplacementDefinition> = new Map();
  /** Executes the preprocessor asynchronously.
   * @param input The entry input document to be preprocessed. URI must be empty for code embedded in other files.
   * @param includes Max include depth, to avoid infinite recursion.
   * @returns The resulting unit with diagnostics and chunks mapping input code to outputs.
   */
  async preprocess(input: PreprocessingFile, includes = 25): Promise<PreprocessedUnit> {
    const { uri, code } = input;
    const chunks: PreprocessedChunk[] = [];
    const diagnostics: PreprocessorDiagnostic[] = [];
    let inBlockComment = false, inDirective = false;
    let tokens: TokenString[] = [];
    let expandingMacro: MacroExpansion | null = null, openedParentheses = 0;
    let lineStart = 1, columnStart = 0, i0 = 0;
    let line = 1, column = 0;
    //TODO code is too big, try to break into named functions somehow
    for (let i = 0; i < code.length;) {
      const c2: string = code.substring(i, i + 2), c1 = c2[0]!;
      if (inBlockComment) { // skip this char
        if (c2 == '*/') { // end block comment
          i += 2; column += 2; inBlockComment = false;
          if (inDirective) tokens.push(' ');
          else if (expandingMacro) {
            const args = expandingMacro.arguments!, nArgs = args.length;
            if (nArgs) args[nArgs - 1] += ' ';
          }
          continue;
        }
      } else if (c2 == '//') { // skip line comment until end of line
        let c; i++; do { i++; c = code[i] ?? ''; } while (c && c != '\n' && c != '\r'); continue;
      } else if (c2 == '/*') { // begin block comment
        i += 2; column += 2; inBlockComment = true; continue;
      } else if (inDirective) { // parse directive
        if (c2 == '\\\n' || c2 == '\\\r') { // line continuation; skip backslash and the line terminator
          i++; if (code.substring(i, i + 2) == '\r\n') i++; i++; column = 0; line++; continue;
        } else if (c1 == '\n' || c1 == '\r') { // end directive
          const location = { uri, start: { line: lineStart, column: columnStart }, end: { line, column } };
          const replacement = await this.#directive(includes, tokens, diagnostics, location);
          chunks.push({ inputCode: code.substring(i0, i), replacement });
          i0 = i; // replace directive code until before the ending newline
          inDirective = false; tokens = []; // consumed tokens when exiting a directive
        } else if (c1 == '"') { // gather directive string atomically verbatim
          const start = { line, column };
          let tokenCode = '"'; i++; column++;
          let s = countString(code, i);
          while (s < 0) { // flipped (negative) count means it's a line continuation
            s = ~s; // reverse flipped bits to get char count
            tokenCode += code.substring(i, i + s); // append directive line up to before continuation backslash
            i += s + 1; // advance until after continuation backslash
            if (code.substring(i, i + 2) == '\r\n') i++;
            i++; column = 0; line++; // advance until after newline
            s = countString(code, i);
          }
          tokenCode += code.substring(i, i + s);
          i += s; column += s;
          const end = { line, column };
          tokens.push({ code: tokenCode, start, end });
          continue;
        } else if (/\w/.test(c1) && !/\w/.test(code[i - 1] ?? '')) { // gather identifier token atomically verbatim
          const start = { line, column };
          let tokenCode = c1; i++; column++;
          for (let c; /\\[\n\r]|^\w/.test(c = code.substring(i, i + 2));) {
            if (c == '\\\n' || c == '\\\r') { i += 2; column = 0; line++; } // can contain line continuations
            else { tokenCode += c[0]!; i++; column++; } // append char
          }
          const end = { line, column };
          tokens.push({ code: tokenCode, start, end });
          continue;
        } else tokens.push(c1); // gather directive line
      } else if (expandingMacro) { // parse expansion of macro defined as function-like
        const args = expandingMacro.arguments!, iArg = args.length - 1;
        if (/\s/.test(c1)) { // on whitespace or newline, push and skip normally below
          if (iArg >= 0) args[iArg]! += ' ';
        } else if (c1 == '(') {
          if (iArg < 0) args.push(''); // if just opened macro parenthesis, add space to collect first arg
          else args[iArg]! += '(';
          openedParentheses++; // always track parentheses to match; skip normally below
        } else if (iArg < 0) { // other char when expecting '('
          expandingMacro = null; continue; // leave alone as a non-macro identifier with same name
        } else if (c1 == ')') {
          if (--openedParentheses < 1) { // closed last parenthesis, so process macro expansion
            i++; column++;
            const location = { uri, start: { line: lineStart, column: columnStart }, end: { line, column } };
            const replacement = this.#expansion(expandingMacro, diagnostics, location);
            chunks.push({ inputCode: code.substring(i0, i), replacement });
            i0 = i; // replace expansion code into the macro identifier
            expandingMacro = null; continue; // finished macro expansion
          } else args[iArg]! += ')'; // continue below
        } else if (c1 == ',' && openedParentheses == 1) {
          args.push(''); // add space to collect next arg
        } else if (c1 == '"') { // gather single-line string token atomically
          i++; column++; let s = countString(code, i);
          if (s < 0) s = ~s + 1; // line continuation is unsupported; in this case count the '\' too and end string
          args[iArg]! += '"' + code.substring(i, i + s);
          i += s; column += s; continue;
        } else { // on any other char, push it to args; code will be processed later
          args[iArg]! += c1;
        }
      } else if (c1 == '#') { // begin directive
        const preColumn = columnOfPreviousTokenInLine(code, i, column);
        if (preColumn >= 0) { // uncommented code cannot appear preceding # on the same line
          const start = { line, column: preColumn }, end = { line, column: preColumn + 1 };
          const msg = 'code before a directive on the same line is not allowed';
          diagnostics.push({ location: { uri, start, end }, msg, id: 'PDirectivePos' });
          i++; column++; continue;
        }
        chunks.push({ inputCode: code.substring(i0, i) });
        i0 = i; // pushed chunk of code verbatim up to before # char
        lineStart = line; columnStart = column;
        inDirective = true; tokens.push('#');
        i++; column++; continue;
      } else if (c1 == '"') { // skip single-line string token atomically
        i++; column++; let s = countString(code, i);
        if (s < 0) s = ~s + 1; // line continuation is unsupported; in this case count the '\' too and end string
        i += s; column += s; continue;
      } else if (/\w/.test(c1) && !/\w/.test(code[i - 1] ?? '')) { // get identifier token atomically verbatim
        let tokenCode = c1, l = 1;
        for (let c; /\w/.test(c = code[i + l] ?? '');) { tokenCode += c; l++; } // append chars
        const definition = this.macros.get(tokenCode);
        if (!definition) { // not a macro; just skip the non-macro identifier
          i += l; column += l; continue;
        } // else identifier is a macro
        chunks.push({ inputCode: code.substring(i0, i) });
        i0 = i; // pushed chunk of code verbatim up to before macro identifier
        const start = { line, column };
        i += l; column += l;
        const end = { line, column }, identifier = { code: tokenCode, start, end };
        if (definition.parameters) { // macro requires call, keep gathering tokens for it
          expandingMacro = { identifier, definition, arguments: [] };
          lineStart = start.line; columnStart = start.column;
        } else { // already finish macro here on just the identifier
          const macro = { identifier, definition, arguments: null }, location = { uri, start, end };
          const replacement = this.#expansion(macro, diagnostics, location);
          chunks.push({ inputCode: code.substring(i0, i), replacement });
          i0 = i; // replace expansion code into the macro identifier
        }
        continue;
      } // else do nothing special, just skip keeping text as is until this chunk is handled
      // advance to next index and to next column or line
      if (c2 == '\r\n') { i += 2; column = 0; line++; }
      else if (c1 == '\n' || c1 == '\r') { i++; column = 0; line++; }
      else { i++; column++; }
    }
    if (inBlockComment) {
      const position = { line, column }, msg = 'unterminated block comment';
      diagnostics.push({ location: { uri, start: position, end: position }, msg, id: 'PEndComment' });
      if (inDirective) tokens.push(' ');
      else if (expandingMacro) {
        const args = expandingMacro.arguments!, nArgs = args.length;
        if (nArgs) args[nArgs - 1] += ' ';
      }
    }
    if (inDirective) {
      const location = { uri, start: { line: lineStart, column: columnStart }, end: { line, column } };
      const replacement = await this.#directive(includes, tokens, diagnostics, location);
      chunks.push({ inputCode: code.substring(i0), replacement });
    } else {
      if (expandingMacro?.arguments!.length) {
        const location = { uri, start: { line: lineStart, column: columnStart }, end: { line, column } };
        diagnostics.push({ location, msg: 'unterminated macro expansion call', id: 'PEndExpansion' });
      }
      chunks.push({ inputCode: code.substring(i0) });
    }
    return new PreprocessedUnit(input, chunks, diagnostics);
  }
  #expansion(
    macro: MacroExpansion, diagnostics: PreprocessorDiagnostic[], location: CodeLocation,
  ): PreprocessedOutput | undefined {
    //TEST
    const args = macro.arguments ? '(\n  ' + macro.arguments.join(',\n  ') + '\n)' : 'no';
    const parameters = macro.definition.parameters;
    const p = parameters ? '(\n  ' + parameters.join(',\n  ') + '\n)' : 'no';
    const msg = `TODO: expand macro '${macro.identifier.code}' with ${args} args;
defined with ${p} params as: '${macro.definition.code}'`;
    diagnostics.push({ location, msg, id: '' });
    return undefined;
    //TODO ensure arity matches, otherwise, raise error and replace with just macro name
    //TODO apply arguments as per macro definition, then exclude macro name and reapply remaining macros on a loop
  }
  async #directive(
    includes: number, tokens: TokenString[], diagnostics: PreprocessorDiagnostic[], location: CodeLocation,
  ): Promise<PreprocessedOutput> {
    const line = tokens.map(t => typeof t == 'string' ? t : t.code).join('');
    const directiveToken = tokens[1] ?? '';
    const directiveKeyword = typeof directiveToken == 'string' ? directiveToken : directiveToken.code;
    switch (directiveKeyword) {
      case 'include': return await this.#include(includes, tokens, diagnostics, location, line);
    }
    //TODO #define #if #pragma etc...
    const msg = `invalid or unsupported directive '#${directiveKeyword}' in: '${line}'`;
    diagnostics.push({ location, msg, id: 'PDirectiveMiss' });
    return PreprocessorProblem.output(location, line);
  }
  async #include(
    includes: number, tokens: TokenString[], diagnostics: PreprocessorDiagnostic[], location: CodeLocation,
    line: string,
  ): Promise<PreprocessedOutput> {
    if (includes <= 0) {
      const msg = 'include depth is limited to avoid infinite recursion';
      diagnostics.push({ location, msg, id: 'PIncludeDeep' });
      return PreprocessorProblem.output(location, line);
    }
    let stringToken;
    for (let i = 2, n = tokens.length; i < n; i++) {
      const token = tokens[i]!;
      if (typeof token == 'string') { if (/^[ \t]*$/.test(token)) continue; } // ignore whitespace
      else if (stringToken == null && /^"(?:[^"\\]|\\["\\])+"$/.test(token.code)) { stringToken = token; continue; }
      stringToken = undefined; break; // the only token in the directive line after #include must be a string
    }
    if (!stringToken) {
      const msg = `malformed include directive: '${line}'`;
      diagnostics.push({ location, msg, id: 'PIncludeForm' });
      return PreprocessorProblem.output(location, line);
    }
    const str = stringToken.code;
    const path = str.substring(1, str.length - 1).replace(/\\(["\\])/g, '$1');
    let loadedFile; try {
      loadedFile = await this.loader(path, location.uri);
    } catch (e) {
      const msg = typeof e == 'string' ? e : 'some error occurred in the path loader:\n' + e;
      diagnostics.push({ location, msg, id: 'PIncludePath' });
      return PreprocessorProblem.output(location, line);
    }
    const subUnit = await this.preprocess(loadedFile, includes - 1);
    const msg = 'from included file';
    for (const d of subUnit.diagnostics) {
      const cause: PreprocessorDiagnostic = { location: d.location, msg, cause: d.cause, id: '' };
      diagnostics.push({ location, cause, msg: d.msg, id: d.id });
    }
    return {
      code: subUnit.preprocessedCode,
      construct: new PreprocessorInclude(location, stringToken, line, path, subUnit),
    };
  }
}

const docsUrl = 'https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/shader_preprocessor.html';
export const preprocessorErrorTypes = {
  PEndComment: docsUrl + '#shader-preprocessor',
  PEndExpansion: docsUrl + '#shader-preprocessor',
  PDirectivePos: docsUrl + '#directives',
  PDirectiveMiss: docsUrl + '#directives',
  PIncludeForm: docsUrl + '#include',
  PIncludeDeep: docsUrl + '#include',
  PIncludePath: docsUrl + '#include',
};

/** Represents a parsed preprocessor construct from which code is replaced. */
export abstract class PreprocessorConstruct {
  location: CodeLocation;
  mainRange: CodeRange;
  constructor(location: CodeLocation, mainRange: CodeRange) {
    this.location = location;
    this.mainRange = mainRange;
  }
}
/** Represents a parsed preprocessor construct that has a problem. */
export class PreprocessorProblem extends PreprocessorConstruct {
  directiveLine: string;
  constructor(location: CodeLocation, directiveLine: string) {
    super(location, location);
    this.directiveLine = directiveLine;
  }
  static output(location: CodeLocation, directiveLine: string): PreprocessedOutput {
    return { code: commentOut(directiveLine), construct: new PreprocessorProblem(location, directiveLine) };
  }
}
/** Represents a valid preprocessor macro expansion. */
export abstract class PreprocessorExpansion extends PreprocessorConstruct {
}
/** Represents a valid preprocessor `#` directive. */
export abstract class PreprocessorDirective extends PreprocessorConstruct {
  directiveLine: string;
  constructor(location: CodeLocation, mainRange: CodeRange, line: string) {
    super(location, mainRange);
    this.directiveLine = line;
  }
}

/** Represents a valid preprocessor `#include` directive. */
export class PreprocessorInclude extends PreprocessorDirective {
  path: string;
  unit: PreprocessedUnit;
  constructor(location: CodeLocation, mainRange: CodeRange, line: string, path: string, unit: PreprocessedUnit) {
    super(location, mainRange, line);
    this.path = path;
    this.unit = unit;
  }
}

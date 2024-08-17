// GDShader Preprocessor

type Other = { [_: string]: undefined; };

export interface PreprocessingFile { uri: string; code: string; }

interface CodePosition {
  /** The 1-based line position. */
  line: number;
  /** The 0-based character position in the line. */
  column: number;
}
interface CodeRange {
  /** The start position. */
  start: CodePosition;
  /** The end position. */
  end: CodePosition;
}
interface CodeLocation extends CodeRange {
  /** The URI of the source. */
  uri: string;
}
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
  for (const l = line - 1; i < l; i++) b += lines[i].length;
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
    const { length } = lines[i];
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
   * Occurrences of identifier `args` on `code` will be replaced upon expansion.
   */
  macros: Map<string, { args?: string[]; code: string; }> = new Map();
  /** Executes the preprocessor asynchronously.
   * @param input The entry input document to be preprocessed. URI must be empty for code embedded in other files.
   * @param includes Max include depth, to avoid infinite recursion.
   * @returns The resulting unit with diagnostics and chunks mapping input code to outputs.
   */
  async preprocess(input: PreprocessingFile, includes = 25): Promise<PreprocessedUnit> {
    const { uri, code } = input;
    const chunks: PreprocessedChunk[] = [];
    const diagnostics: PreprocessorDiagnostic[] = [];
    let inBlockComment = false, inDirective = '';
    let lineStart = 1, columnStart = 0, i0 = 0;
    let line = 1, column = 0;
    for (let i = 0; i < code.length;) {
      let c = code.substring(i, i + 2), l;
      if (inBlockComment) { // skip this char
        if (c == '*/') { // end block comment
          i += 2; column += 2; inBlockComment = false; if (inDirective) inDirective += ' '; continue;
        }
      } else if (c == '//') { // skip line comment until end of line
        i++; do { i++; c = code[i]; } while (c && c != '\n' && c != '\r'); continue;
      } else if (c == '/*') { // begin block comment
        i += 2; column += 2; inBlockComment = true; continue;
      } else if (inDirective) { // parse directive
        if (c == '\\\n' || c == '\\\r') { // line continuation
          i++; c = code.substring(i, i + 2); // skip backslash and the line terminator
        } else if (/^\n|^\r/.test(c)) { // end directive
          const location = { uri, start: { line: lineStart, column: columnStart }, end: { line, column } };
          const replacement = await this.#directive(includes, inDirective, diagnostics, location);
          chunks.push({ inputCode: code.substring(i0, i), replacement });
          i0 = i; // replace directive code until before the ending newline
          inDirective = ''; // empty means no longer in a directive
        } else if (c[0] == '"') { // gather directive string atomically verbatim
          inDirective += '"'; i++; column++;
          let s = countString(code, i);
          while (s < 0) { // flipped (negative) count means it's a line continuation
            s = ~s; // reverse flipped bits to get char count
            inDirective += code.substring(i, i + s); // append directive line up to before continuation backslash
            i += s + 1; // advance until after continuation backslash
            c = code.substring(i, i + 2); if (c == '\r\n') i++;
            i++; column = 0; line++; // advance until after newline
            s = countString(code, i);
          }
          inDirective += code.substring(i, i + s);
          i += s; column += s; continue;
        } else inDirective += c[0]; // gather directive line
      } else if (c[0] == '#') { // begin directive
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
        inDirective = '#';
        i++; column++; continue;
      } else if (c[0] == '"') { // skip string line atomically
        i++; column++;
        let s = countString(code, i);
        if (s < 0) s = ~s + 1; // line continuation is unsupported; count the backslash too and end string
        i += s; column += s; continue;
      } // else do nothing special, just skip keeping text as is until this chunk is handled
      // advance to next index and to next column or line
      if (c == '\r\n') { i += 2; column = 0; line++; }
      else if (/^\n|^\r/.test(c)) { i++; column = 0; line++; }
      else { i++; column++; }
    }
    if (inBlockComment) {
      const position = { line, column }, msg = 'unterminated block comment';
      diagnostics.push({ location: { uri, start: position, end: position }, msg, id: 'PEndComment' });
      if (inDirective) inDirective += ' ';
    }
    if (inDirective) {
      const location = { uri, start: { line: lineStart, column: columnStart }, end: { line, column } };
      const replacement = await this.#directive(includes, inDirective, diagnostics, location);
      chunks.push({ inputCode: code.substring(i0), replacement });
    } else {
      chunks.push({ inputCode: code.substring(i0) });
    }
    return new PreprocessedUnit(input, chunks, diagnostics);
  }
  async #directive(includes: number, directiveLine: string, diagnostics: PreprocessorDiagnostic[],
    location: CodeLocation,
  ): Promise<PreprocessedOutput> {
    let m;
    if ((m = /^#include[ \t]+"((?:[^"\\]|\\["\\])+)"[ \t]*$/.exec(directiveLine))) {
      if (includes <= 0) {
        const msg = 'include depth is limited to avoid infinite recursion';
        diagnostics.push({ location, msg, id: 'PIncludeDeep' });
        return PreprocessorProblem.output(location, directiveLine);
      }
      const path = m[1].replaceAll('\\"', '"').replaceAll('\\\\', '\\');
      let loadedFile; try {
        loadedFile = await this.loader(path, location.uri);
      } catch (e) {
        const msg = typeof e == 'string' ? e : 'some error occurred in the path loader:\n' + e;
        diagnostics.push({ location, msg, id: 'PIncludePath' });
        return PreprocessorProblem.output(location, directiveLine);
      }
      const subUnit = await this.preprocess(loadedFile, includes - 1);
      const msg = 'from included file';
      for (const d of subUnit.diagnostics) {
        const cause: PreprocessorDiagnostic = { location: d.location, msg, cause: d.cause, id: '' };
        diagnostics.push({ location, cause, msg: d.msg, id: d.id });
      }
      return {
        code: subUnit.preprocessedCode,
        construct: new PreprocessorInclude(location, directiveLine, path, subUnit),
      };
    }
    //TODO #define #if #pragma etc...
    const msg = `invalid, malformed or unsupported directive: '${directiveLine}'`;
    diagnostics.push({ location, msg, id: 'PDirectiveMiss' });
    return PreprocessorProblem.output(location, directiveLine);
  }
}

const docsUrl = 'https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/shader_preprocessor.html';
export const preprocessorErrorTypes = {
  PEndComment: docsUrl + '#shader-preprocessor',
  PDirectivePos: docsUrl + '#directives',
  PDirectiveMiss: docsUrl + '#directives',
  PIncludeDeep: docsUrl + '#include',
  PIncludePath: docsUrl + '#include',
};

/** Represents a parsed preprocessor construct from which code is replaced. */
export abstract class PreprocessorConstruct {
  //TODO add optional idRange for just the id part
  location: CodeLocation;
  constructor(location: CodeLocation) {
    this.location = location;
  }
}
/** Represents a parsed preprocessor construct that has a problem. */
export class PreprocessorProblem extends PreprocessorConstruct {
  directiveLine: string;
  constructor(location: CodeLocation, directiveLine: string) {
    super(location);
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
  constructor(location: CodeLocation, directiveLine: string) {
    super(location);
    this.directiveLine = directiveLine;
  }
}

/** Represents a valid preprocessor `#include` directive. */
export class PreprocessorInclude extends PreprocessorDirective {
  path: string;
  unit: PreprocessedUnit;
  constructor(location: CodeLocation, directiveLine: string, path: string, unit: PreprocessedUnit) {
    super(location, directiveLine);
    this.path = path;
    this.unit = unit;
  }
}

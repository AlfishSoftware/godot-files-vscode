// GDShader Preprocessor

type Other = { [_: string]: undefined; };

export interface PreprocessingFile {
  readonly uri: string;
  readonly code: string;
}

export interface CodePosition {
  /** The 1-based line position. */
  readonly line: number;
  /** The 0-based character position in the line. */
  readonly column: number;
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

function commentOut(code: string) {
  return '//' + code.replace(/\n|\r\n?/g, '$&//');
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

interface PreprocessingStatePosition {
  line: number; column: number; i: number;
}
interface PreprocessingState extends PreprocessingStatePosition {
  readonly chunks: PreprocessedChunk[];
  readonly diagnostics: PreprocessorDiagnostic[];
  expandingMacro: MacroExpansion | null;
  openedParentheses: number;
  lineStart: number; columnStart: number; i0: number;
}
interface PreprocessingStateFile extends PreprocessingState {
  inBlockComment: boolean;
  inDirective: boolean;
  tokens: TokenString[];
}

function skipLineComment(code: string, p: PreprocessingStatePosition): void {
  let c; p.i++; do { p.i++; c = code[p.i] ?? ''; } while (c && c != '\n' && c != '\r');
}
function readCommentStart(p: PreprocessingStateFile): void {
  p.i += 2; p.column += 2; p.inBlockComment = true; // begin block comment
}
function readCommentEnd(p: PreprocessingStateFile): void {
  p.i += 2; p.column += 2; p.inBlockComment = false; // end block comment
  endComment(p);
}
function endComment(p: PreprocessingStateFile): void {
  if (p.inDirective) p.tokens.push(' ');
  else if (p.expandingMacro) {
    const args = p.expandingMacro.arguments!, nArgs = args.length;
    if (nArgs) args[nArgs - 1] += ' ';
  }
}

function readDirectiveStart(input: PreprocessingFile, p: PreprocessingStateFile): void {
  // begin directive
  const { uri, code } = input;
  const preColumn = columnOfPreviousTokenInLine(code, p.i, p.column);
  if (preColumn >= 0) { // uncommented code cannot appear preceding # on the same line
    const start = { line: p.line, column: preColumn }, end = { line: p.line, column: preColumn + 1 };
    const msg = 'code before a directive on the same line is not allowed';
    p.diagnostics.push({ location: { uri, start, end }, msg, id: 'PDirectivePos' });
    p.i++; p.column++; return;
  }
  p.chunks.push({ inputCode: code.substring(p.i0, p.i) });
  p.i0 = p.i; // pushed chunk of code verbatim up to before # char
  p.lineStart = p.line; p.columnStart = p.column;
  p.inDirective = true; p.tokens.push('#');
  p.i++; p.column++;
}
function readLineContinuationInDirective(code: string, p: PreprocessingStatePosition): void {
  // line continuation; skip backslash and the line terminator
  p.i++; if (code.substring(p.i, p.i + 2) == '\r\n') p.i++; p.i++; p.column = 0; p.line++;
}
function readCharInDirective(p: PreprocessingStateFile, c2: string, c1: string): void {
  p.tokens.push(c1); skipChar(p, c2, c1); // gather directive line
}
async function readDirectiveEnd(
  preprocessor: GDShaderPreprocessorBase, input: PreprocessingFile, includes: number,
  p: PreprocessingStateFile, c2: string, c1: string
): Promise<void> {
  // end directive
  const { uri, code } = input;
  const replacement = await endDirective(preprocessor, uri, includes, p);
  p.chunks.push({ inputCode: code.substring(p.i0, p.i), replacement });
  p.i0 = p.i; // replace directive code until before the ending newline
  p.inDirective = false; p.tokens = []; // consumed tokens when exiting a directive
  skipChar(p, c2, c1);
}
async function endDirective(
  preprocessor: GDShaderPreprocessorBase, uri: string, includes: number, p: PreprocessingStateFile
): Promise<PreprocessedOutput> {
  const location = {
    uri, start: { line: p.lineStart, column: p.columnStart }, end: { line: p.line, column: p.column }
  };
  return await directive(preprocessor, p.tokens, p.diagnostics, location, includes);
}

function readMacroExpansionCall(
  macros: ReadonlyMap<string, MacroReplacementDefinition>,
  input: PreprocessingFile, p: PreprocessingState, c2: string, c1: string
): void {
  // macro defined as function-like
  const { uri, code } = input, expandingMacro = p.expandingMacro!;
  const args = expandingMacro.arguments!, iArg = args.length - 1;
  if (/\s/.test(c1)) { // on whitespace or newline, push and skip normally below
    if (iArg >= 0) args[iArg]! += ' ';
  } else if (c1 == '(') {
    if (iArg < 0) args.push(''); // if just opened macro parenthesis, add space to collect first arg
    else args[iArg]! += '(';
    p.openedParentheses++; // always track parentheses to match; skip normally below
  } else if (iArg < 0) { // other char when expecting '('
    p.expandingMacro = null;
    return; // leave alone as a non-macro identifier with same name
  } else if (c1 == ')') {
    if (--p.openedParentheses < 1) { // closed last parenthesis, so process macro expansion
      p.i++; p.column++;
      const location = {
        uri, start: { line: p.lineStart, column: p.columnStart }, end: { line: p.line, column: p.column }
      };
      const replacement = expansion(expandingMacro, macros, p.diagnostics, location);
      p.chunks.push({ inputCode: code.substring(p.i0, p.i), replacement });
      p.i0 = p.i; // replace expansion code into the macro identifier
      p.expandingMacro = null;
      return; // finished macro expansion
    } else args[iArg]! += ')'; // continue below
  } else if (c1 == ',' && p.openedParentheses == 1) {
    args.push(''); // add space to collect next arg
  } else if (c1 == '"') { // gather single-line string token atomically
    p.i++; p.column++; let s = countString(code, p.i);
    if (s < 0) s = ~s + 1; // line continuation is unsupported; in this case count the '\' too and end string
    if (code[p.i + s - 1] != '"') p.expandingMacro = null; // if not properly terminated, cancel expansion
    else args[iArg]! += '"' + code.substring(p.i, p.i + s); // else add the valid single-line string code to args
    p.i += s; p.column += s;
    return;
  } else { // on any other char, push it to args; code will be processed later
    args[iArg]! += c1;
  }
  skipChar(p, c2, c1);
}

function readString(code: string, p: PreprocessingStatePosition): void {
  // skip single-line string token atomically
  p.i++; p.column++;
  let s = countString(code, p.i);
  if (s < 0) s = ~s + 1; // line continuation is unsupported; in this case count the '\' too and end string
  p.i += s; p.column += s;
}
function readStringInDirective(code: string, p: PreprocessingStateFile): void {
  // gather directive string atomically verbatim
  const start = { line: p.line, column: p.column };
  let tokenCode = '"'; p.i++; p.column++;
  let s = countString(code, p.i);
  while (s < 0) { // flipped (negative) count means it's a line continuation
    s = ~s; // reverse flipped bits to get char count
    tokenCode += code.substring(p.i, p.i + s); // append directive line up to before continuation backslash
    p.i += s + 1; // advance until after continuation backslash
    if (code.substring(p.i, p.i + 2) == '\r\n') p.i++;
    p.i++; p.column = 0; p.line++; // advance until after newline
    s = countString(code, p.i);
  }
  tokenCode += code.substring(p.i, p.i + s);
  p.i += s; p.column += s;
  const end = { line: p.line, column: p.column };
  p.tokens.push({ code: tokenCode, start, end });
}

function readIdentifier(
  macros: ReadonlyMap<string, MacroReplacementDefinition>, input: PreprocessingFile, p: PreprocessingState, c1: string
): void {
  // get identifier token atomically verbatim
  const { uri, code } = input;
  let tokenCode = c1, l = 1;
  for (let c; /\w/.test(c = code[p.i + l] ?? '');) { tokenCode += c; l++; } // append chars
  const definition = macros.get(tokenCode);
  if (!definition) { // not a macro; just skip the non-macro identifier
    p.i += l; p.column += l; return;
  } // else identifier is a macro
  p.chunks.push({ inputCode: code.substring(p.i0, p.i) });
  p.i0 = p.i; // pushed chunk of code verbatim up to before macro identifier
  const start = { line: p.line, column: p.column };
  p.i += l; p.column += l;
  const end = { line: p.line, column: p.column }, identifier = { code: tokenCode, start, end };
  if (definition.parameters) { // macro requires call, keep gathering tokens for it
    p.expandingMacro = { identifier, definition, arguments: [] };
    p.lineStart = start.line; p.columnStart = start.column;
  } else { // already finish macro here on just the identifier
    const macro = { identifier, definition, arguments: null }, location = { uri, start, end };
    const replacement = expansion(macro, macros, p.diagnostics, location);
    p.chunks.push({ inputCode: code.substring(p.i0, p.i), replacement });
    p.i0 = p.i; // replace expansion code into the macro identifier
  }
}
function readIdentifierInDirective(code: string, p: PreprocessingStateFile, c1: string): void {
  const start = { line: p.line, column: p.column };
  let tokenCode = c1; p.i++; p.column++;
  for (let c; /\\[\n\r]|^\w/.test(c = code.substring(p.i, p.i + 2));) {
    if (c == '\\\n' || c == '\\\r') { p.i += 2; p.column = 0; p.line++; } // can contain line continuations
    else { tokenCode += c[0]!; p.i++; p.column++; } // append char
  }
  const end = { line: p.line, column: p.column };
  p.tokens.push({ code: tokenCode, start, end });
}

function skipChar(p: PreprocessingStatePosition, c2: string, c1: string): void {
  // advance to next index and to next column or line
  if (c2 == '\r\n') { p.i += 2; p.column = 0; p.line++; return; }
  if (c1 == '\n' || c1 == '\r') { p.column = 0; p.line++; } else p.column++;
  p.i++;
}

function endCode(input: PreprocessingFile, p: PreprocessingState): void {
  const { uri, code } = input;
  if (p.expandingMacro?.arguments!.length) {
    const location = {
      uri, start: { line: p.lineStart, column: p.columnStart }, end: { line: p.line, column: p.column }
    };
    p.diagnostics.push({ location, msg: 'unterminated macro expansion call', id: 'PEndExpansion' });
  }
  p.chunks.push({ inputCode: code.substring(p.i0) });
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
    const p: PreprocessingStateFile = {
      inBlockComment: false, inDirective: false, tokens: [],
      chunks: [],
      diagnostics: [],
      expandingMacro: null, openedParentheses: 0,
      lineStart: 1, columnStart: 0, i0: 0,
      line: 1, column: 0, i: 0,
    };
    while (p.i < code.length) {
      const c2: string = code.substring(p.i, p.i + 2), c1 = c2[0]!;
      if (p.inBlockComment) // skip this char
        if (c2 == '*/') readCommentEnd(p);
        else skipChar(p, c2, c1);
      else if (c2 == '//') skipLineComment(code, p); // skip line comment until end of line
      else if (c2 == '/*') readCommentStart(p);
      else if (p.inDirective) // parse directive
        if (c2 == '\\\n' || c2 == '\\\r') readLineContinuationInDirective(code, p);
        else if (c1 == '\n' || c1 == '\r') await readDirectiveEnd(this, input, includes, p, c2, c1);
        else if (c1 == '"') readStringInDirective(code, p);
        else if (/\w/.test(c1) && !/\w/.test(code[p.i - 1] ?? '')) readIdentifierInDirective(code, p, c1);
        else readCharInDirective(p, c2, c1);
      else if (p.expandingMacro) readMacroExpansionCall(this.macros, input, p, c2, c1);
      else if (c1 == '#') readDirectiveStart(input, p);
      else if (c1 == '"') readString(code, p);
      else if (/\w/.test(c1) && !/\w/.test(code[p.i - 1] ?? '')) readIdentifier(this.macros, input, p, c1);
      else skipChar(p, c2, c1); // do nothing special, just skip keeping text as is until this chunk is handled
    }
    if (p.inBlockComment) {
      const position = { line: p.line, column: p.column }, msg = 'unterminated block comment';
      p.diagnostics.push({ location: { uri, start: position, end: position }, msg, id: 'PEndComment' });
      endComment(p);
    }
    if (p.inDirective) {
      p.chunks.push({ inputCode: code.substring(p.i0), replacement: await endDirective(this, uri, includes, p) });
    } else endCode(input, p);
    return new PreprocessedUnit(input, p.chunks, p.diagnostics);
  }
}

const docsUrl = 'https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/shader_preprocessor.html';
export const preprocessorErrorTypes = {
  PEndComment: docsUrl + '#shader-preprocessor',
  PEndExpansion: docsUrl + '#shader-preprocessor',
  PExpansionArity: docsUrl + '#define',
  PDirectivePos: docsUrl + '#directives',
  PDirectiveMiss: docsUrl + '#directives',
  PIncludeForm: docsUrl + '#include',
  PIncludeDeep: docsUrl + '#include',
  PIncludePath: docsUrl + '#include',
  PDefineWho: docsUrl + '#define',
  PDefineClash: docsUrl + '#define',
  PDefineParams: docsUrl + '#define',
  PDefineTouchy: docsUrl + '#define',
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
  parsedLine: string;
  constructor(location: CodeLocation, parsedLine: string) {
    super(location, location);
    this.parsedLine = parsedLine;
  }
  static output(location: CodeLocation, parsedLine: string): PreprocessedOutput {
    return { code: commentOut(parsedLine), construct: new PreprocessorProblem(location, parsedLine) };
  }
}

/** Represents a valid preprocessor macro expansion. */
export class PreprocessorExpansion extends PreprocessorConstruct {
  macro: MacroExpansion;
  constructor(location: CodeLocation, macro: MacroExpansion) {
    super(location, macro.identifier);
    this.macro = macro;
  }
}
function expansion(
  macro: MacroExpansion, macros: ReadonlyMap<string, MacroReplacementDefinition>,
  diagnostics: PreprocessorDiagnostic[], location: CodeLocation,
): PreprocessedOutput | undefined {
  const args = macro.arguments, { definition } = macro;
  const macroIdentifier = macro.identifier.code;
  let { code } = definition;
  if (args) { // function-like expansion
    const nArgs = args.length >= 2 ? args.length : /^\s*$/.test(args[0]!) ? 0 : 1;
    const { parameters } = definition, nParams = parameters!.length;
    if (nArgs != nParams) { // ensure arity matches; otherwise, raise error and replace with just macro name
      const msg = `number of macro expansion arguments (${nArgs}) must match the parameters (${nParams})`;
      diagnostics.push({ location, msg, id: 'PExpansionArity' });
      return { code: macroIdentifier, construct: new PreprocessorExpansion(location, macro) };
    }
    if (nArgs) code = code.replaceAll(
      RegExp('"(?:[^"\\\\]|\\\\["\\\\])*"|\\b(?:' + parameters!.join('|') + ')\\b', 'g'),
      s => s.startsWith('"') ? s : args[parameters!.indexOf(s)] ?? s
    ); // replaced args into parameters all at once
  } // else expanding onto an identifier only
  code = code.replace(/(?<=[^#\s])\s*##\s*(?=[^#\s])/g, ''); // handle ## concatenation token
  code = ` ${code} `; // always surround expansion with spaces to avoid gluing tokens
  // exclude this macro def and reapply expansion on the output code for the remaining defs recursively
  const subMacros = new Map(macros);
  subMacros.delete(macroIdentifier);
  if (subMacros.size) {
    const uri = location.uri, input = { uri, code };
    const p: PreprocessingState = {
      chunks: [],
      diagnostics: [],
      expandingMacro: null, openedParentheses: 0,
      lineStart: 1, columnStart: 0, i0: 0,
      line: 1, column: 0, i: 0,
    };
    while (p.i < code.length) {
      const c2: string = code.substring(p.i, p.i + 2), c1 = c2[0]!;
      if (p.expandingMacro) readMacroExpansionCall(subMacros, input, p, c2, c1);
      else if (c1 == '"') readString(code, p);
      else if (/\w/.test(c1) && !/\w/.test(code[p.i - 1] ?? '')) readIdentifier(subMacros, input, p, c1);
      else skipChar(p, c2, c1); // do nothing special, just skip keeping text as is until this chunk is handled
    }
    endCode(input, p);
    code = p.chunks.map(c => c.replacement?.code ?? c.inputCode).join('');
  }
  diagnostics.push({ location, msg: `DEBUG: expands to '${code}'`, id: '' });
  return { code, construct: new PreprocessorExpansion(location, macro) };
}

/** Represents a valid preprocessor `#` directive. */
export abstract class PreprocessorDirective extends PreprocessorConstruct {
  directiveLine: string;
  constructor(location: CodeLocation, mainRange: CodeRange, line: string) {
    super(location, mainRange);
    this.directiveLine = line;
  }
}
async function directive(
  preprocessor: GDShaderPreprocessorBase, tokens: readonly TokenString[], diagnostics: PreprocessorDiagnostic[],
  location: CodeLocation, includes: number,
): Promise<PreprocessedOutput> {
  const line = tokens.map(t => typeof t == 'string' ? t : t.code).join('');
  const directiveToken = tokens[1] ?? '';
  const directiveKeyword = typeof directiveToken == 'string' ? directiveToken : directiveToken.code;
  switch (directiveKeyword) {
    case 'include': return await include(preprocessor, tokens, diagnostics, location, includes, line);
    case 'define': return define(preprocessor, tokens, diagnostics, location, line)
  }
  //TODO #undef #ifdef #if #pragma etc...
  const msg = `invalid or unsupported directive '#${directiveKeyword}' in: '${line}'`;
  diagnostics.push({ location, msg, id: 'PDirectiveMiss' });
  return PreprocessorProblem.output(location, line);
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
async function include(
  preprocessor: GDShaderPreprocessorBase, tokens: readonly TokenString[], diagnostics: PreprocessorDiagnostic[],
  location: CodeLocation, includes: number, line: string,
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
    loadedFile = await preprocessor.loader(path, location.uri);
  } catch (e) {
    const msg = typeof e == 'string' ? e : 'some error occurred in the path loader:\n' + e;
    diagnostics.push({ location, msg, id: 'PIncludePath' });
    return PreprocessorProblem.output(location, line);
  }
  const subUnit = await preprocessor.preprocess(loadedFile, includes - 1);
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

/** Represents a valid preprocessor `#define` directive. */
export class PreprocessorDefine extends PreprocessorDirective {
  identifier: PreprocessorToken;
  definition: MacroReplacementDefinition;
  constructor(
    location: CodeLocation, line: string, identifier: PreprocessorToken, definition: MacroReplacementDefinition
  ) {
    super(location, identifier, line);
    this.identifier = identifier;
    this.definition = definition;
  }
}
function define(
  preprocessor: GDShaderPreprocessorBase, tokens: readonly TokenString[], diagnostics: PreprocessorDiagnostic[],
  location: CodeLocation, line: string,
): PreprocessedOutput {
  let identifier: PreprocessorToken | null = null, i = 2;
  const n = tokens.length;
  for (; i < n; i++) {
    const token = tokens[i]!;
    if (typeof token == 'string') { if (/^[ \t]*$/.test(token)) continue; } // ignore whitespace
    else if (/^[A-Z_a-z]\w*$/.test(token.code)) { identifier = token; } // we want an identifier
    break; // stop at first non-space token
  }
  if (!identifier) {
    const msg = `expected identifier after '#define' in: '${line}'`;
    diagnostics.push({ location, msg, id: 'PDefineWho' });
    return PreprocessorProblem.output(location, line);
  }
  const macroIdentifier = identifier.code;
  if (preprocessor.macros.has(macroIdentifier)) {
    const msg = `redefinition of macro '${macroIdentifier}'`;
    const loc = { uri: location.uri, start: identifier.start, end: identifier.end };
    //TODO we can add cause 'previously defined here' by adding constructs with locations to map of macros
    diagnostics.push({ location: loc, msg, id: 'PDefineClash' });
    return PreprocessorProblem.output(loc, line);
  }
  let parameters: string[] | null, code = '';
  const openToken = tokens[++i] ?? '';
  if (openToken == '(') {
    parameters = []; // parse parameter identifiers
    let last: '(' | 'x' | ',' | ')' = '('; // '('=atStart; 'x'=afterIdentifier; ','=afterComma; ')'=endedOk;
    for (i++; i < n; i++) {
      const token = tokens[i]!;
      if (typeof token == 'string') {
        if (token == ')') { if (last != ',') last = ')'; break; } // end here or when no more tokens
        if (/^[ \t]*$/.test(token)) continue; // ignore whitespace
        if (last == 'x' && token == ',') { last = ','; continue; }
      } else if (last != 'x' && /^[A-Z_a-z]\w*$/.test(token.code)) {
        parameters.push(token.code); last = 'x'; continue;
      }
      break; // unexpected token
    }
    if (last != ')') { // did not end as expected
      const expected: string = last == 'x' ? "',' or ')'" : last == ',' ? 'identifier' : "identifier or ')'";
      const msg = `expected ${expected} in the parameter list of: '${line}'`;
      diagnostics.push({ location, msg, id: 'PDefineParams' });
      return PreprocessorProblem.output(location, line);
    }
  } else if (typeof openToken == 'string' && /^[ \t]*$/.test(openToken)) {
    parameters = null; // no parameters, just start code definition
  } else { // identifier is touching some non-whitespace token
    const msg = `missing whitespace after macro name in: '${line}'`;
    diagnostics.push({ location, msg, id: 'PDefineTouchy' });
    return PreprocessorProblem.output(location, line);
  }
  // skip leading whitespace
  for (i++; i < n; i++) {
    const token = tokens[i]!;
    if (typeof token != 'string' || !/^[ \t]*$/.test(token)) break;
  }
  let spaceBuffer = '';
  for (; i < n; i++) {
    const token = tokens[i]!;
    if (typeof token == 'string') {
      if (/^[ \t]*$/.test(token)) { spaceBuffer += token; continue; } // skip trailing whitespace
      else code += spaceBuffer + token;
    } else code += spaceBuffer + token.code; // could also add code tokens for identifiers into a construct field
    spaceBuffer = ''; // added non-trailing whitespace, so clean buffer
  }
  const definition = { parameters, code };
  preprocessor.macros.set(macroIdentifier, definition);
  return { code: commentOut(line), construct: new PreprocessorDefine(location, line, identifier, definition) };
}

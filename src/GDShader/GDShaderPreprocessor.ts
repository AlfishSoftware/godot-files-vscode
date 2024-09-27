// Public Domain, as per The Unlicense. NO WARRANTY.
// Independent GDShader Preprocessor for IDEs. This module has no dependencies at all, and runs on both NodeJS and Web.

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
  readonly start: CodePosition;
  /** The end position. */
  readonly end: CodePosition;
}
interface CodeLocation extends CodeRange {
  /** The URI of the source. */
  readonly uri: string;
}
interface PreprocessorToken extends CodeRange {
  /** The preprocessed token text. */
  readonly code: string;
  /** The numerical value, if the token represents a signed int32. */
  readonly intValue?: number;
}
export interface PreprocessorDiagnostic {
  /** A code for the type of error. */
  readonly id: '' | keyof typeof preprocessorErrorTypes;
  /** The error message. */
  readonly msg: string;
  /** Target location in code. */
  readonly location: CodeLocation;
  /** Trace of causes until the original source at the end of the list. */
  readonly cause?: PreprocessorDiagnostic;
}

/** Definition code associated with a macro name. */
interface MacroDefinition {
  readonly parameterNames: null | readonly string[];
  readonly body: string;
}
interface MacroExpansion {
  readonly identifier: PreprocessorToken;
  readonly definition: MacroDefinition;
  readonly arguments: null | string[];
}
type MacrosAvailable = ReadonlyMap<string, MacroDefinition>;
export type MacrosDefined = Map<string, MacroDefinition>;

export interface MappedLocation {
  readonly unit: PreprocessedUnit;
  readonly inputPosition: number;
  readonly inputLength: number;
  readonly chunkIndex: number;
  readonly replacement?: PreprocessedOutput;
  readonly original?: MappedLocation;
}
interface PreprocessedChunk {
  readonly inputCode: string;
  readonly active: boolean;
  readonly replacement?: PreprocessedOutput;
}
interface PreprocessedOutput<T extends PreprocessorConstruct = PreprocessorConstruct> {
  readonly code: string;
  readonly construct: T;
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
    this.preprocessedCode = joinChunks(chunks);
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
      const outputCode = chunkOutputCode(chunk);
      const chunkOutputLength = outputCode.length;
      if (outputPosition < chunkOutputLength) break;
      outputPosition -= chunkOutputLength;
      inputPosition += chunk.inputCode.length;
      i++;
    }
    if (!chunk || !chunk.replacement)
      return { unit: this, inputPosition: inputPosition + outputPosition, inputLength: 0, chunkIndex: i };
    const replacement = chunk.replacement;
    const construct = replacement.construct;
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
  listInactiveRanges(): CodeRange[] {
    const ranges: CodeRange[] = [];
    let inputStart = 0;
    for (const chunk of this.chunks) {
      const inputEnd = inputStart + chunk.inputCode.length;
      if (!chunk.active) ranges.push({ start: this.inputPositionAt(inputStart), end: this.inputPositionAt(inputEnd) });
      inputStart = inputEnd;
    }
    return ranges;
  }
}

function chunkOutputCode(chunk: PreprocessedChunk): string {
  return chunk.active ? chunk.replacement?.code ?? chunk.inputCode : '';
}
function joinChunks(chunks: PreprocessedChunk[]): string {
  return chunks.map(chunkOutputCode).join('');
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
  readonly branchingStack: PreprocessorBranchBegin[];
  expandingMacro: MacroExpansion | null;
  openedParentheses: number;
  lineStart: number; columnStart: number; i0: number;
}
interface PreprocessingStateFile extends PreprocessingState {
  readonly macros: MacrosDefined;
  inDirective: boolean;
  tokens: PreprocessorToken[];
}

function isActive(branchingStack: PreprocessorBranchBegin[]): boolean {
  return !branchingStack.some(b => !b.activeBranch);
}

function skipLineComment(code: string, p: PreprocessingStatePosition): void {
  let c; p.i++; do { p.i++; c = code[p.i] ?? ''; } while (c && c != '\n' && c != '\r');
}
function skipBlockComment(input: PreprocessingFile, p: PreprocessingStateFile): void {
  const { uri, code } = input, start = { line: p.line, column: p.column };
  p.i += 2; p.column += 2; // begin block comment
  while (p.i < code.length) {
    const c2: string = code.substring(p.i, p.i + 2);
    if (c2 == '*/') {
      p.i += 2; p.column += 2; // end block comment
      endBlockComment(p, start);
      return;
    } else skipChar(p, c2, c2[0]!);
  }
  const position = { line: p.line, column: p.column }, msg = 'unterminated block comment';
  p.diagnostics.push({ location: { uri, start: position, end: position }, msg, id: 'PEndComment' });
  endBlockComment(p, start);
}
function endBlockComment(p: PreprocessingStateFile, start: CodePosition): void {
  if (p.inDirective) p.tokens.push({ code: ' ', start, end: { line: p.line, column: p.column } });
  else if (p.expandingMacro) {
    const args = p.expandingMacro.arguments!, nArgs = args.length;
    if (nArgs) args[nArgs - 1] += ' ';
  }
}

function readDirectiveStart(input: PreprocessingFile, p: PreprocessingStateFile): void {
  // begin directive
  const { uri, code } = input, { line, column } = p;
  const preColumn = columnOfPreviousTokenInLine(code, p.i, column);
  if (preColumn >= 0) { // uncommented code cannot appear preceding # on the same line
    const start = { line, column: preColumn }, end = { line, column: preColumn + 1 };
    const msg = 'code before a directive on the same line is not allowed';
    p.diagnostics.push({ location: { uri, start, end }, msg, id: 'PDirectivePos' });
    p.i++; p.column++;
    return;
  }
  p.chunks.push({ inputCode: code.substring(p.i0, p.i), active: isActive(p.branchingStack) });
  p.i0 = p.i; // pushed chunk of code verbatim up to before # char
  p.lineStart = line; p.columnStart = column;
  p.inDirective = true;
  p.tokens.push({ code: '#', start: { line, column }, end: { line, column: column + 1 } });
  p.i++; p.column++;
}
function skipLineContinuationInDirective(code: string, p: PreprocessingStatePosition): void {
  // line continuation; skip backslash and the line terminator
  p.i++; if (code.substring(p.i, p.i + 2) == '\r\n') p.i++; p.i++; p.column = 0; p.line++;
}
function readWhitespaceInDirective(p: PreprocessingStateFile, c1: string): void {
  const { line, column } = p;
  p.tokens.push({ code: c1, start: { line, column }, end: { line, column: column + 1 } }); p.column++; p.i++;
}
function readNumberInDirective(code: string, p: PreprocessingStateFile, c1: string): void {
  // we only care about integer literals for now
  const start = { line: p.line, column: p.column };
  let tokenCode = c1, c: string; p.i++; p.column++; // 1st char is a decimal digit
  while (/\\[\n\r]/.test(code.substring(p.i, p.i + 2))) skipLineContinuationInDirective(code, p);
  if (/^[xX]/.test(c = code[p.i] ?? '')) {
    tokenCode += c; p.i++; p.column++;
    while (/\\[\n\r]|^[0-9A-Fa-f]/.test(c = code.substring(p.i, p.i + 2))) {
      if (c == '\\\n' || c == '\\\r') { skipLineContinuationInDirective(code, p); }
      else { tokenCode += c[0]; p.i++; p.column++; } // append hex digit
    }
  } else while (/\\[\n\r]|^\d/.test(c = code.substring(p.i, p.i + 2))) {
    if (c == '\\\n' || c == '\\\r') { skipLineContinuationInDirective(code, p); }
    else { tokenCode += c[0]; p.i++; p.column++; } // append decimal digit
  }
  if (/^[uU]/.test(c = code[p.i] ?? '')) { tokenCode += c; p.i++; p.column++; }
  const end = { line: p.line, column: p.column };
  p.tokens.push({ code: tokenCode, start, end });
}
function readPairSymbolInDirective(code: string, p: PreprocessingStateFile, c1: string): void {
  const start = { line: p.line, column: p.column };
  let tokenCode = c1; p.i++; p.column++; // 1st symbol char: =!<>&|
  let r: RegExp, end: CodePosition;
  switch (c1) { // look for the next char, which might be broken by line continuations
    case '<': r = /^[<=]/; break; // look for '<' or '='
    case '>': r = /^[>=]/; break; // look for '>' or '='
    case '!': case '=': r = /^=/; break; // look for '='
    case '&': r = /^&/; break; // look for '&'
    case '|': r = /^\|/; break; // look for '|'
    default: throw null;
  }
  while (/\\[\n\r]/.test(code.substring(p.i, p.i + 2))) skipLineContinuationInDirective(code, p);
  const c = code[p.i] ?? '';
  if (r.test(c)) { tokenCode += c; p.i++; p.column++; end = { line: p.line, column: p.column }; } // 2nd char
  else end = { line: start.line, column: start.column + 1 }; // if only 1 char, exclude line continuations from token
  p.tokens.push({ code: tokenCode, start, end });
}
function readCharSymbolInDirective(p: PreprocessingStateFile, c1: string): void {
  // 1 char symbol: -+*/%~^() or any other char
  const { line, column } = p;
  p.tokens.push({ code: c1, start: { line, column }, end: { line, column: column + 1 } });
  p.column++; p.i++;
}
async function readDirectiveEnd(
  preprocessor: GDShaderPreprocessorBase, input: PreprocessingFile, includes: number,
  p: PreprocessingStateFile, c2: string, c1: string
): Promise<void> {
  // end directive
  await endDirective(preprocessor, input, includes, p);
  p.i0 = p.i; // replace directive code until before the ending newline
  p.inDirective = false; p.tokens = []; // consumed tokens when exiting a directive
  skipChar(p, c2, c1);
}

function readMacroExpansionCall(
  macros: MacrosAvailable, input: PreprocessingFile, p: PreprocessingState, c2: string, c1: string
): void {
  // macro defined as function-like
  const { uri, code } = input, expandingMacro = p.expandingMacro!;
  const args = expandingMacro.arguments!, iArg = args.length - 1;
  if (/\s/.test(c1)) { // on whitespace or newline, push and skip normally below
    if (iArg >= 0) args[iArg]! += ' ';
  } else if (c1 == '(') {
    if (iArg < 0) args.push(''); // if just opened macro parenthesis, add entry to collect first arg
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
      const replacement
        = expansion(expandingMacro, macros, p.diagnostics, location);
      p.chunks.push({ inputCode: code.substring(p.i0, p.i), active: isActive(p.branchingStack), replacement });
      p.i0 = p.i; // replace expansion code into the macro identifier
      p.expandingMacro = null;
      return; // finished macro expansion
    } else args[iArg]! += ')'; // continue below
  } else if (c1 == ',' && p.openedParentheses == 1) {
    args.push(''); // add entry to collect next arg
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
  macros: MacrosAvailable, input: PreprocessingFile, p: PreprocessingState, c1: string
): void {
  // get identifier token atomically verbatim
  const { uri, code } = input;
  let tokenCode = c1, l = 1;
  for (let c; /\w/.test(c = code[p.i + l] ?? '');) { tokenCode += c; l++; } // append chars
  const definition = macros.get(tokenCode);
  if (!definition) { // not a macro; just skip the non-macro identifier
    p.i += l; p.column += l; return;
  } // else identifier is a macro
  p.chunks.push({ inputCode: code.substring(p.i0, p.i), active: isActive(p.branchingStack) });
  p.i0 = p.i; // pushed chunk of code verbatim up to before macro identifier
  const start = { line: p.line, column: p.column };
  p.i += l; p.column += l;
  const end = { line: p.line, column: p.column }, identifier = { code: tokenCode, start, end };
  if (definition.parameterNames) { // macro requires call, keep gathering tokens for it
    p.expandingMacro = { identifier, definition, arguments: [] };
    p.lineStart = start.line; p.columnStart = start.column;
  } else { // already finish macro here on just the identifier
    const macro = { identifier, definition, arguments: null }, location = { uri, start, end };
    const replacement = expansion(macro, macros, p.diagnostics, location);
    p.chunks.push({ inputCode: code.substring(p.i0, p.i), active: isActive(p.branchingStack), replacement });
    p.i0 = p.i; // replace expansion code into the macro identifier
  }
}
function readIdentifierInDirective(code: string, p: PreprocessingStateFile, c1: string): void {
  const start = { line: p.line, column: p.column };
  let tokenCode = c1; p.i++; p.column++;
  for (let c; /\\[\n\r]|^\w/.test(c = code.substring(p.i, p.i + 2));) {
    if (c == '\\\n' || c == '\\\r') { skipLineContinuationInDirective(code, p); }
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
  p.chunks.push({ inputCode: code.substring(p.i0), active: isActive(p.branchingStack) });
}

/** Implementation for a GDShader Preprocessor that is suitable for IDEs.
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
  /** Executes the preprocessor asynchronously.
   * @param input The entry input document to be preprocessed. URI must be empty for code embedded in other files.
   * @param macros Maps macro names to definitions. Will be updated as `#define`|`#undef` directives appear in the code.
   * Can be used to set initial external macros that don't come from code `#define` directives.
   * @param includes Max `#include` depth, to avoid infinite recursion.
   * @returns The resulting unit with diagnostics and chunks mapping input code to outputs.
   */
  async preprocess(
    input: PreprocessingFile, macros: MacrosDefined = new Map(), includes = 25
  ): Promise<PreprocessedUnit> {
    const { uri, code } = input;
    const p: PreprocessingStateFile = {
      branchingStack: [],
      macros,
      inDirective: false, tokens: [],
      chunks: [],
      diagnostics: [],
      expandingMacro: null, openedParentheses: 0,
      lineStart: 1, columnStart: 0, i0: 0,
      line: 1, column: 0, i: 0,
    };
    while (p.i < code.length) {
      const c2: string = code.substring(p.i, p.i + 2), c1 = c2[0]!;
      if (c2 == '//') skipLineComment(code, p); // skip line comment until end of line
      else if (c2 == '/*') skipBlockComment(input, p); // skip entire block comment here
      else if (p.inDirective) // parse directive
        if (c2 == '\\\n' || c2 == '\\\r') skipLineContinuationInDirective(code, p);
        else if (c1 == '\n' || c1 == '\r') await readDirectiveEnd(this, input, includes, p, c2, c1);
        else if (c1 == ' ' || c1 == '\t') readWhitespaceInDirective(p, c1);
        else if (c1 == '"') readStringInDirective(code, p);
        else if (/[a-z_A-Z]/.test(c1) && !/\w/.test(code[p.i - 1] ?? '')) readIdentifierInDirective(code, p, c1);
        else if (/\d/.test(c1) && !/\w/.test(code[p.i - 1] ?? '')) readNumberInDirective(code, p, c1);
        else if (/[=!<>&|]/.test(c1)) readPairSymbolInDirective(code, p, c1);
        else readCharSymbolInDirective(p, c1);
      else if (p.expandingMacro) readMacroExpansionCall(macros, input, p, c2, c1);
      else if (c1 == '#') readDirectiveStart(input, p);
      else if (c1 == '"') readString(code, p);
      else if (/[a-z_A-Z]/.test(c1) && !/\w/.test(code[p.i - 1] ?? '')) readIdentifier(macros, input, p, c1);
      else skipChar(p, c2, c1); // do nothing special, just skip keeping text as is until this chunk is handled
    }
    if (p.inDirective) await endDirective(this, input, includes, p);
    else endCode(input, p);
    if (p.branchingStack.length) {
      const position = { line: p.line, column: p.column }, msg = `missing '#endif'`;
      p.diagnostics.push({ location: { uri, start: position, end: position }, msg, id: 'PEndifMissing' });
    }
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
  PDirectiveTouchy: docsUrl + '#directives',
  
  PDefinedMisnomer: docsUrl + '#if',
  PDefinedSyntax: docsUrl + '#if',
  
  PConditionNone: docsUrl + '#if',
  PConditionString: docsUrl + '#if',
  PConditionLiteral: docsUrl + '#if',
  PConditionSyntax: docsUrl + '#if',
  
  PIncludeForm: docsUrl + '#include',
  PIncludeDeep: docsUrl + '#include',
  PIncludePath: docsUrl + '#include',
  
  PDefineWho: docsUrl + '#define',
  PDefineClash: docsUrl + '#define',
  PDefineParams: docsUrl + '#define',
  PDefineTouchy: docsUrl + '#define',
  
  PUndefWho: docsUrl + '#undef',
  PUndefExtra: docsUrl + '#undef',
  
  PEndifUnmatched: docsUrl + '#endif',
  PEndifMissing: docsUrl + '#endif',
  PEndifExtra: docsUrl + '#endif',
  
  PIfdefWho: docsUrl + '#ifdef',
  PIfdefExtra: docsUrl + '#ifdef',
  
  PIfndefWho: docsUrl + '#ifndef',
  PIfndefExtra: docsUrl + '#ifndef',
  
  PElifUnmatched: docsUrl + '#elif',
  
  PElseUnmatched: docsUrl + '#else',
  PElseExtra: docsUrl + '#else',
};

/** Represents a parsed preprocessor construct from which code is replaced. */
export abstract class PreprocessorConstruct {
  constructor(
    readonly location: CodeLocation,
    readonly mainRange: CodeRange,
  ) {
  }
}
/** Represents a parsed preprocessor construct that has a problem. */
export class PreprocessorProblem extends PreprocessorConstruct {
  constructor(location: CodeLocation,
    readonly parsedLine: string,
  ) {
    super(location, location);
  }
  static output(location: CodeLocation, parsedLine: string): PreprocessedOutput<PreprocessorProblem> {
    return { code: commentOut(parsedLine), construct: new PreprocessorProblem(location, parsedLine) };
  }
}

/** Represents a valid preprocessor macro expansion. */
export class PreprocessorExpansion extends PreprocessorConstruct {
  constructor(location: CodeLocation,
    readonly macro: MacroExpansion,
  ) {
    super(location, macro.identifier);
  }
}
function expansion(
  macro: MacroExpansion, macros: MacrosAvailable, diagnostics: PreprocessorDiagnostic[], location: CodeLocation,
): PreprocessedOutput<PreprocessorExpansion> {
  const args = macro.arguments, { definition } = macro;
  const macroIdentifier = macro.identifier.code;
  let code = definition.body;
  if (args) { // function-like expansion
    const nArgs = args.length >= 2 ? args.length : /^\s*$/.test(args[0]!) ? 0 : 1;
    const parameterNames = definition.parameterNames!, nParams = parameterNames.length;
    if (nArgs != nParams) { // ensure arity matches; otherwise, raise error and replace with just macro name
      const msg = `number of macro expansion arguments (${nArgs}) must match the parameters (${nParams})`;
      diagnostics.push({ location, msg, id: 'PExpansionArity' });
      return { code: macroIdentifier, construct: new PreprocessorExpansion(location, macro) };
    }
    if (nArgs) code = code.replaceAll(
      RegExp('"(?:[^"\\\\]|\\\\["\\\\])*"|\\b(?:' + parameterNames.join('|') + ')\\b', 'g'),
      s => s.startsWith('"') ? s : args[parameterNames.indexOf(s)] ?? s
    ); // replaced args into parameters all at once
  } // else expanding onto an identifier only
  code = code.replace(/(?<=[^#\s])\s*##\s*(?=[^#\s])/g, ''); // handle ## concatenation token
  code = ` ${code} `; // always surround expansion with spaces to avoid gluing tokens
  // exclude this macro def and reapply expansion on the output code for the remaining defs recursively
  const subMacros = new Map(macros);
  subMacros.delete(macroIdentifier);
  code = expandCode({ uri: location.uri, code }, subMacros);
  diagnostics.push({ location, msg: `DEBUG: expands to '${code}'`, id: '' });
  return { code, construct: new PreprocessorExpansion(location, macro) };
}

/** Perform only macro expansions on the code, for any macros found from the set. */
function expandCode(input: PreprocessingFile, macros: MacrosAvailable): string {
  let { code } = input;
  if (macros.size) {
    const p: PreprocessingState = {
      chunks: [],
      diagnostics: [],
      expandingMacro: null, openedParentheses: 0,
      branchingStack: [],
      lineStart: 1, columnStart: 0, i0: 0,
      line: 1, column: 0, i: 0,
    };
    while (p.i < code.length) {
      const c2: string = code.substring(p.i, p.i + 2), c1 = c2[0]!;
      if (p.expandingMacro) readMacroExpansionCall(macros, input, p, c2, c1);
      else if (c1 == '"') readString(code, p);
      else if (/[a-z_A-Z]/.test(c1) && !/\w/.test(code[p.i - 1] ?? '')) readIdentifier(macros, input, p, c1);
      else skipChar(p, c2, c1); // do nothing special, just skip keeping text as is until this chunk is handled
    }
    endCode(input, p);
    code = joinChunks(p.chunks);
  }
  return code;
}

/** Represents a valid preprocessor `#` directive. */
export abstract class PreprocessorDirective extends PreprocessorConstruct {
  constructor(location: CodeLocation, mainRange: CodeRange,
    readonly directiveLine: string,
  ) {
    super(location, mainRange);
  }
}
async function endDirective(
  preprocessor: GDShaderPreprocessorBase, input: PreprocessingFile, includes: number, p: PreprocessingStateFile
): Promise<void> {
  const { uri, code } = input;
  const location = {
    uri, start: { line: p.lineStart, column: p.columnStart }, end: { line: p.line, column: p.column }
  };
  const replacement = await directive(preprocessor, location, p, includes);
  const { construct } = replacement, { branchingStack } = p;
  let active: boolean;
  if (construct instanceof PreprocessorBranchBegin) {
    if (construct instanceof PreprocessorElseIf || construct instanceof PreprocessorElse) branchingStack.pop();
    active = isActive(branchingStack);
    branchingStack.push(construct);
  } else active = isActive(branchingStack);
  p.chunks.push({ inputCode: code.substring(p.i0, p.i), active, replacement });
}
async function directive(
  preprocessor: GDShaderPreprocessorBase, location: CodeLocation, p: PreprocessingStateFile, includes: number,
): Promise<PreprocessedOutput<PreprocessorDirective | PreprocessorProblem>> {
  const { diagnostics, macros, branchingStack } = p, tokens: readonly PreprocessorToken[] = p.tokens;
  const line = tokens.map(t => t.code).join('');
  const directiveKeyword = tokens[1]?.code ?? '';
  const afterDirective = tokens[2]?.code ?? '';
  if (!/^[ \t]*$/.test(afterDirective)) {
    const msg = `missing whitespace after '#${directiveKeyword}' in: '${line}'`;
    diagnostics.push({ location, msg, id: 'PDirectiveTouchy' });
    return PreprocessorProblem.output(location, line);
  }
  switch (directiveKeyword) {
    case 'include':
      return await includeDirective(
        tokens, diagnostics, isActive(branchingStack), location, line, macros, preprocessor, includes
      );
    case 'define':
      return defineDirective(tokens, diagnostics, isActive(branchingStack), location, line, macros);
    case 'undef':
      return undefDirective(tokens, diagnostics, isActive(branchingStack), location, line, macros);
    case 'endif':
      if (!branchingStack.pop()) {
        diagnostics.push({ location, msg: `unmatched '#endif'`, id: 'PEndifUnmatched' });
        return PreprocessorProblem.output(location, line);
      }
      return endifDirective(tokens, diagnostics, location, line, macros);
    case 'else': case 'elif':
      const prev = branchingStack.at(-1);
      const isElif = directiveKeyword == 'elif';
      if (!prev || prev instanceof PreprocessorElse) {
        const id = isElif ? 'PElifUnmatched' : 'PElseUnmatched';
        diagnostics.push({ location, msg: `unmatched '#${directiveKeyword}'`, id });
        return PreprocessorProblem.output(location, line);
      }
      return (isElif ? elifDirective : elseDirective)(tokens, diagnostics, prev.activeBranch, location, line, macros);
    case 'ifdef': case 'ifndef':
      return ifdefDirective(
        tokens, diagnostics, isActive(branchingStack), location, line, macros, directiveKeyword == 'ifdef'
      );
    case 'if':
      return ifDirective(tokens, diagnostics, isActive(branchingStack), location, line, macros);
    //TODO case 'pragma': return pragmaDirective(tokens, diagnostics, location, line, macros);
    default:
      const msg = `invalid or unsupported directive '#${directiveKeyword}' in: '${line}'`;
      diagnostics.push({ location, msg, id: 'PDirectiveMiss' });
      return PreprocessorProblem.output(location, line);
  }
}

/** Represents a valid preprocessor `#include` directive. */
export class PreprocessorInclude extends PreprocessorDirective {
  constructor(location: CodeLocation, mainRange: CodeRange, line: string,
    readonly path: string,
    readonly unit: PreprocessedUnit | null,
  ) {
    super(location, mainRange, line);
  }
}
async function includeDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], activeParent: boolean,
  location: CodeLocation, line: string, macros: MacrosDefined,
  preprocessor: GDShaderPreprocessorBase, includes: number,
): Promise<PreprocessedOutput<PreprocessorInclude | PreprocessorProblem>> {
  if (includes <= 0) {
    const msg = 'include depth is limited to avoid infinite recursion';
    diagnostics.push({ location, msg, id: 'PIncludeDeep' });
    return PreprocessorProblem.output(location, line);
  }
  let stringToken;
  for (let i = 2, n = tokens.length; i < n; i++) {
    const token = tokens[i]!, tokenCode = token.code;
    if (/^[ \t]*$/.test(tokenCode)) continue; // ignore whitespace
    else if (stringToken == null && /^"(?:[^"\\]|\\["\\])+"$/.test(tokenCode)) { stringToken = token; continue; }
    stringToken = undefined; break; // the only token in the directive line after #include must be a string
  }
  if (!stringToken) {
    const msg = `malformed include directive: '${line}'`;
    diagnostics.push({ location, msg, id: 'PIncludeForm' });
    return PreprocessorProblem.output(location, line);
  }
  const str = stringToken.code;
  const path = str.substring(1, str.length - 1).replace(/\\(["\\])/g, '$1');
  if (!activeParent)
    return { code: commentOut(line), construct: new PreprocessorInclude(location, stringToken, line, path, null) };
  let loadedFile; try {
    loadedFile = await preprocessor.loader(path, location.uri);
  } catch (e) {
    const msg = typeof e == 'string' ? e : 'some error occurred in the path loader:\n' + e;
    diagnostics.push({ location, msg, id: 'PIncludePath' });
    return PreprocessorProblem.output(location, line);
  }
  const subUnit = await preprocessor.preprocess(loadedFile, macros, includes - 1);
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
export class PreprocessorDefine extends PreprocessorDirective implements MacroDefinition {
  constructor(location: CodeLocation, line: string,
    readonly identifier: PreprocessorToken,
    readonly parameters: null | readonly PreprocessorToken[],
    readonly body: string,
  ) {
    super(location, identifier, line);
    this.parameterNames = this.parameters?.map(p => p.code) ?? null;
  }
  readonly parameterNames: readonly string[] | null;
}
function defineDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], activeParent: boolean,
  location: CodeLocation, line: string, macros: MacrosDefined,
): PreprocessedOutput<PreprocessorDefine | PreprocessorProblem> {
  let identifier: PreprocessorToken | null = null, i = 2;
  const n = tokens.length;
  for (; i < n; i++) {
    const token = tokens[i]!;
    if (/^[ \t]*$/.test(token.code)) continue; // ignore whitespace
    else if (/^[A-Z_a-z]\w*$/.test(token.code)) { identifier = token; } // we want an identifier
    break; // stop at first non-space token
  }
  if (!identifier) {
    const msg = `expected identifier after '#define' in: '${line}'`;
    diagnostics.push({ location, msg, id: 'PDefineWho' });
    return PreprocessorProblem.output(location, line);
  }
  const macroIdentifier = identifier.code;
  const isForbiddenName = macroIdentifier == 'defined';
  if (isForbiddenName) {
    const loc = { uri: location.uri, start: identifier.start, end: identifier.end };
    diagnostics.push({ location: loc, msg: `'defined' cannot be used as a macro name`, id: 'PDefinedMisnomer' });
    return PreprocessorProblem.output(loc, line);
  }
  if (activeParent && macros.has(macroIdentifier)) {
    const loc = { uri: location.uri, start: identifier.start, end: identifier.end };
    const msg = `redefinition of macro '${macroIdentifier}'`;
    const other = macros.get(macroIdentifier)!;
    //TODO? 'previously defined here': trace includes; try using output location instead somehow, then sourcemap?
    if (other instanceof PreprocessorDefine) diagnostics.push({
      location: loc, msg, id: 'PDefineClash', cause: {
        location: other.location, msg: 'previously defined here', id: ''
      }
    });
    else diagnostics.push({ location: loc, msg: msg + ' already defined externally', id: 'PDefineClash' });
    return PreprocessorProblem.output(loc, line);
  }
  let parameters: PreprocessorToken[] | null, body = '';
  const openTokenCode = tokens[++i]?.code ?? '';
  if (openTokenCode == '(') {
    parameters = []; // parse parameter identifiers
    let last: '(' | 'x' | ',' | ')' = '('; // '('=atStart; 'x'=afterIdentifier; ','=afterComma; ')'=endedOk;
    for (i++; i < n; i++) {
      const token = tokens[i]!, tokenCode = token.code;
      if (/^[ \t]*$/.test(tokenCode)) continue; // ignore whitespace
      if (last == 'x' && tokenCode == ',') { last = ','; continue; }
      else if (tokenCode == ')') {
        if (last != ',') last = ')'; break; // end here or when no more tokens
      } else if (last != 'x' && /^[A-Z_a-z]\w*$/.test(tokenCode)) {
        parameters.push(token); last = 'x'; continue;
      }
      break; // unexpected token
    }
    if (last != ')') { // did not end as expected
      const expected: string = last == 'x' ? "',' or ')'" : last == ',' ? 'identifier' : "identifier or ')'";
      const msg = `expected ${expected} in the parameter list of: '${line}'`;
      diagnostics.push({ location, msg, id: 'PDefineParams' });
      return PreprocessorProblem.output(location, line);
    }
  } else if (/^[ \t]*$/.test(openTokenCode)) {
    parameters = null; // no parameters, just start code definition
  } else { // identifier is touching some non-whitespace token
    const msg = `missing whitespace after macro name in: '${line}'`;
    diagnostics.push({ location, msg, id: 'PDefineTouchy' });
    return PreprocessorProblem.output(location, line);
  }
  // skip leading whitespace
  for (i++; i < n; i++) {
    const token = tokens[i]!;
    if (!/^[ \t]*$/.test(token.code)) break;
  }
  let spaceBuffer = '';
  for (; i < n; i++) {
    const token = tokens[i]!, tokenCode = token.code;
    if (/^[ \t]*$/.test(tokenCode)) { spaceBuffer += tokenCode; continue; } // skip trailing whitespace
    else body += spaceBuffer + tokenCode; // could also add code tokens for identifiers into a construct field
    spaceBuffer = ''; // added non-trailing whitespace, so clean buffer
  }
  const construct = new PreprocessorDefine(location, line, identifier, parameters, body);
  if (activeParent) macros.set(macroIdentifier, construct);
  return { code: commentOut(line), construct };
}

/** Parse tokens expecting a single identifier (macro name) and nothing else after the directive keyword. */
function onlyIdentifier(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], location: CodeLocation, line: string
): PreprocessorToken | null {
  const n = tokens.length;
  let identifier: PreprocessorToken | null = null, i = 2;
  for (; i < n; i++) {
    const token = tokens[i]!, tokenCode = token.code;
    if (/^[ \t]*$/.test(tokenCode)) continue; // ignore whitespace
    else if (/^[A-Z_a-z]\w*$/.test(tokenCode)) { identifier = token; } // we want an identifier
    break; // stop at first non-space token
  }
  const directiveKeyword = tokens[1]?.code ?? '';
  if (!identifier) {
    const msg = `expected identifier after '#${directiveKeyword}' in: '${line}'`;
    const id =
      directiveKeyword == 'ifndef' ? 'PIfndefWho' : directiveKeyword == 'ifdef' ? 'PIfdefWho' : 'PUndefWho';
    diagnostics.push({ location, msg, id });
    return null;
  }
  // allow only whitespace after identifier
  for (i++; i < n; i++) {
    const token = tokens[i]!;
    if (!/^[ \t]*$/.test(token.code)) {
      const msg = `unexpected code after '#${directiveKeyword}' identifier in: '${line}'`;
      const id =
        directiveKeyword == 'ifndef' ? 'PIfndefExtra' : directiveKeyword == 'ifdef' ? 'PIfdefExtra' : 'PUndefExtra';
      diagnostics.push({ location, msg, id });
      return null;
    }
  }
  return identifier;
}

function onlyDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], location: CodeLocation, line: string
): boolean {
  const n = tokens.length;
  // allow only whitespace after directive
  for (let i = 2; i < n; i++) {
    const token = tokens[i]!;
    if (/^[ \t]*$/.test(token.code)) continue;
    const directiveKeyword = tokens[1]?.code ?? '';
    const msg = `unexpected code after '#${directiveKeyword}' in: '${line}'`;
    const id = directiveKeyword == 'endif' ? 'PEndifExtra' : 'PElseExtra';
    diagnostics.push({ location, msg, id });
    return false;
  }
  return true;
}

/** Represents a valid preprocessor `#undef` directive. */
export class PreprocessorUndef extends PreprocessorDirective {
  constructor(location: CodeLocation, line: string,
    readonly identifier: PreprocessorToken,
  ) {
    super(location, identifier, line);
  }
}
function undefDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], activeParent: boolean,
  location: CodeLocation, line: string, macros: MacrosDefined,
): PreprocessedOutput<PreprocessorUndef | PreprocessorProblem> {
  const identifier = onlyIdentifier(tokens, diagnostics, location, line);
  if (!identifier) return PreprocessorProblem.output(location, line);
  const macroIdentifier = identifier.code;
  if (macroIdentifier == 'defined') {
    const loc = { uri: location.uri, start: identifier.start, end: identifier.end };
    diagnostics.push({ location: loc, msg: `'defined' cannot be used as a macro name`, id: 'PDefinedMisnomer' });
    return PreprocessorProblem.output(loc, line);
  }
  if (activeParent) macros.delete(macroIdentifier);
  return { code: commentOut(line), construct: new PreprocessorUndef(location, line, identifier) };
}

/** Represents a valid preprocessor branching directive, related to control flow. */
export abstract class PreprocessorBranching extends PreprocessorDirective {
}

/** Represents a valid preprocessor branching directive that ends the previous branch. */
export interface PreprocessorBranchEnd {
}

/** Represents a valid preprocessor `#endif` directive. */
export class PreprocessorEndIf extends PreprocessorBranching implements PreprocessorBranchEnd {
  constructor(location: CodeLocation, line: string) {
    super(location, location, line);
  }
}
function endifDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[],
  location: CodeLocation, line: string, macros: MacrosDefined
): PreprocessedOutput<PreprocessorEndIf | PreprocessorProblem> {
  if (onlyDirective(tokens, diagnostics, location, line))
    return { code: commentOut(line), construct: new PreprocessorEndIf(location, line) };
  return PreprocessorProblem.output(location, line);
}

/** Represents a valid preprocessor branching directive that will start a branch. */
export abstract class PreprocessorBranchBegin extends PreprocessorBranching {
  constructor(location: CodeLocation, mainRange: CodeRange, line: string,
    /** True if branch is active, false if its evaluation resolves to be inactive.
     * Null if it's inactive because a previous alternative was chosen instead, or an ancestor was inactive. */
    readonly activeBranch: boolean | null,
  ) {
    super(location, mainRange, line);
  }
}

/** Represents a valid preprocessor `#else` directive. */
export class PreprocessorElse extends PreprocessorBranchBegin implements PreprocessorBranchEnd {
  constructor(location: CodeLocation, line: string, activeBranch: true | null) {
    super(location, location, line, activeBranch);
  }
}
function elseDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], activeBefore: boolean | null,
  location: CodeLocation, line: string, macros: MacrosDefined
): PreprocessedOutput<PreprocessorElse | PreprocessorProblem> {
  if (!onlyDirective(tokens, diagnostics, location, line))
    return PreprocessorProblem.output(location, line);
  const activeBranch = activeBefore == false ? true : null;
  return { code: commentOut(line), construct: new PreprocessorElse(location, line, activeBranch) };
}

/** Represents a valid preprocessor condition directive, which is evaluated to true or false. */
export abstract class PreprocessorCondition extends PreprocessorBranchBegin {
}
interface ConditionTokens {
  readonly location: CodeLocation;
  readonly tokens: PreprocessorToken[];
}
function conditionTokens(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[],
  location: CodeLocation, macros: MacrosDefined
): ConditionTokens | null {
  let i = 3; const n = tokens.length;
  while (i < n && /^[ \t]*$/.test(tokens[i]!.code)) i++; // skip initial whitespace until first code token
  if (i >= n) {
    diagnostics.push({ location, msg: `missing preprocessor condition expression`, id: 'PConditionNone' });
    return null;
  }
  let j = n - 1;
  while (j > i && /^[ \t]*$/.test(tokens[j]!.code)) j--; // skip final whitespace until last code token
  const firstToken = tokens[i]!, lastToken = tokens[j]!;
  const { uri } = location, exprStart = firstToken.start, exprEnd = lastToken.end;
  // replace tokens for defined calls and macro calls, building a new seq of tokens
  const resolvedTokens: PreprocessorToken[] = [];
  for (let k = i; k < n; k++) { // check for tokens not allowed
    let token = tokens[k]!, tokenCode = token.code;
    if (tokenCode == 'defined') { // resolve `defined(macro_name)` constructs to 0 (false) or 1 (true)
      const definedKeyword = token;
      while (++k < n && /^[ \t]*$/.test(tokens[k]!.code)); // skip whitespace
      if (k >= n || (token = tokens[k]!).code != '(') {
        const msg = `expected '(' after 'defined' keyword`;
        diagnostics.push({ location: { uri, start: token.start, end: token.end }, msg, id: 'PDefinedSyntax' });
        return null;
      }
      while (++k < n && /^[ \t]*$/.test(tokens[k]!.code)); // skip whitespace
      if (k >= n || !/^[A-Z_a-z]\w*$/.test((token = tokens[k]!).code)) {
        const msg = `expected identifier inside 'defined' keyword call`;
        diagnostics.push({ location: { uri, start: token.start, end: token.end }, msg, id: 'PDefinedSyntax' });
        return null;
      }
      const identifier = token;
      while (++k < n && /^[ \t]*$/.test(tokens[k]!.code)); // skip whitespace
      if (k >= n || (token = tokens[k]!).code != ')') {
        const msg = `expected ')' after identifier in 'defined' keyword call`;
        diagnostics.push({ location: { uri, start: token.start, end: token.end }, msg, id: 'PDefinedSyntax' });
        return null;
      }
      token = { code: macros.has(identifier.code) ? '1' : '0', start: definedKeyword.start, end: token.end };
      resolvedTokens.push(token);
      continue;
    } else if (/^[A-Z_a-z]\w*$/.test(tokenCode)) { // identifiers may expand as macros
      const identifier = token;
      const definition = macros.get(tokenCode);
      // allow undefined macros for now, as it only raises "undefined macro" error if evaluation reaches it
      if (!definition) { resolvedTokens.push(identifier); continue; }
      if (!definition.parameterNames) { // parameter-less macro
        const macro = { identifier, definition, arguments: null }, { start, end } = identifier;
        const expandedCode = expansion(macro, macros, diagnostics, { uri, start, end }).code;
        resolvedTokens.push(...expandedTokens(expandedCode, start, end));
        continue;
      }
      // macro has parameters; expand if args are provided
      while (++k < n && /^[ \t]*$/.test(tokens[k]!.code)); // skip whitespace
      if (k >= n || (token = tokens[k]!).code != '(') {
        // allow arg-less macros for now, as the token only raises "undefined macro" error if evaluation reaches it
        resolvedTokens.push(identifier);
        k--; continue; // decrement because it was already pointing to next token
      }
      const { start } = identifier, args: string[] = []; let openedParentheses = 1, arg = '';
      while (openedParentheses && ++k < n) {
        token = tokens[k]!; tokenCode = token.code;
        if (tokenCode == ',') { if (openedParentheses < 2) { args.push(arg); arg = ''; } else arg += ','; }
        else if (tokenCode == ')') { if (--openedParentheses) arg += ')'; }
        else if (tokenCode == '(') { openedParentheses++; arg += '('; }
        else arg += tokenCode;
      }
      const { end } = token, macroLocation = { uri, start, end };
      if (k >= n) {
        const msg = 'unterminated macro expansion call';
        diagnostics.push({ location: macroLocation, msg, id: 'PEndExpansion' });
        return null;
      }
      args.push(arg);
      const macro = { identifier, definition, arguments: args };
      const expandedCode = expansion(macro, macros, diagnostics, macroLocation).code;
      resolvedTokens.push(...expandedTokens(expandedCode, start, end));
      continue;
    } else resolvedTokens.push(token); // push every other token verbatim
  }
  const nTokens = resolvedTokens.length;
  for (let l = 0; l < nTokens; l++) { // check lexical tokens after expansions
    const token = resolvedTokens[l]!, tokenCode = token.code;
    if (tokenCode.startsWith('"')) {
      const msg = 'strings are not allowed in preprocessor condition expressions';
      diagnostics.push({ location: { uri, start: token.start, end: token.end }, msg, id: 'PConditionString' });
      return null;
    }
    //TODO? check float literals and abort as unsupported
    let m;
    if (m = /^(0[xX][0-9A-Fa-f]+|\d+)([uU]?)$/.exec(tokenCode)) { // replace hex and decimal with signed int32 literal
      const { start, end } = token, s = m[1]!;
      if (m[2]!) {
        const msg = 'uint literals are not supported in preprocessor condition expressions';
        diagnostics.push({ location: { uri, start, end }, msg, id: 'PConditionLiteral' });
        return null;
      }
      const d = +s; // parse number from string; this also supports 0x syntax for hex
      if (d >= 0x100000000) { // must fit in 32 bits
        const msg = 'numeric literal is too big for int32';
        diagnostics.push({ location: { uri, start, end }, msg, id: 'PConditionLiteral' });
        return null;
      }
      if (d >= 0x80000000 && !/^0[xX]/.test(s)) { // values >= 2147483648 would become negative when cast to signed int
        const msg = `decimal literal is too big for signed int32, so it overflows to (${d | 0})`;
        diagnostics.push({ location: { uri, start, end }, msg, id: 'PConditionLiteral' });
        return null;
      }
      resolvedTokens[l] = { ...token, intValue: d | 0 };
    }
  }
  return { location: { uri, start: exprStart, end: exprEnd }, tokens: resolvedTokens };
}
function expandedTokens(expandedCode: string, start: CodePosition, end: CodePosition): PreprocessorToken[] {
  const tokens: PreprocessorToken[] = [];
  for (const m of expandedCode.matchAll( // to reparse tokens after a macro expansion, just use regexes
    /\s+|"(?:[^"\\]|\\[^])*"|\b[A-Z_a-z]\w*|\b0[xX][0-9A-Fa-f]+[uU]?|\b\d+[uU]?|[=!<>]=|[<>&|]{2}|[^]/g
  )) {
    // keep same original range from macro call for every replacement token in the result, so errors refer to the call
    tokens.push({ code: m[0], start, end });
  }
  return tokens;
}
//TODO build parse tree, grouping parentheses atomically; put result in a root group; groups have a token sequence
//TODO to evaluate a group, repeat steps below on a loop;
//TODO split by || then inside by &&; evaluate parts in short-circuit logic
//TODO reduce other operators; abort if identifier is evaluated; stop when only a single integer token is left
function evaluateCondition(
  diagnostics: PreprocessorDiagnostic[], condition: ConditionTokens
): boolean | null {
  const { location, tokens } = condition;
  let code = tokens.map(t => t.intValue ?? t.code).join('');
  if (/^\s*-?\s*0*[uU]?\s*$/.test(code)) return false;
  if (/^\s*-?\s*0*[1-9]\d*[uU]?\s*$/.test(code)) return true;
  diagnostics.push({ location, msg: `condition evaluation error`, id: 'PConditionSyntax' });
  return null;
}

/** Represents a valid preprocessor `#elif` directive. */
export class PreprocessorElseIf extends PreprocessorCondition implements PreprocessorBranchEnd {
}
function elifDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], activeBefore: boolean | null,
  location: CodeLocation, line: string, macros: MacrosDefined
): PreprocessedOutput<PreprocessorElseIf | PreprocessorProblem> {
  const condition
    = conditionTokens(tokens, diagnostics, location, macros);
  if (condition == null) return PreprocessorProblem.output(location, line);
  const condLocation = condition.location;
  if (activeBefore == false) {
    const activeBranch = evaluateCondition(diagnostics, condition);
    if (activeBranch == null) return PreprocessorProblem.output(location, line);
    return { code: commentOut(line), construct: new PreprocessorElseIf(location, condLocation, line, activeBranch) };
  } else return { code: commentOut(line), construct: new PreprocessorElseIf(location, condLocation, line, null) };
}

/** Represents a valid preprocessor condition start directive, which must have a corresponding `#endif`. */
export abstract class PreprocessorBeginIf extends PreprocessorCondition {
}

/** Represents a valid preprocessor `#if` directive. */
export class PreprocessorIf extends PreprocessorBeginIf {
}
function ifDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], activeParent: boolean,
  location: CodeLocation, line: string, macros: MacrosDefined,
): PreprocessedOutput<PreprocessorIf | PreprocessorProblem> {
  const condition
    = conditionTokens(tokens, diagnostics, location, macros);
  if (condition == null) return PreprocessorProblem.output(location, line);
  const condLocation = condition.location;
  if (activeParent) {
    const activeBranch = evaluateCondition(diagnostics, condition);
    if (activeBranch == null) return PreprocessorProblem.output(location, line);
    return { code: commentOut(line), construct: new PreprocessorIf(location, condLocation, line, activeBranch) };
  } else return { code: commentOut(line), construct: new PreprocessorIf(location, condLocation, line, null) };
}

/** Represents a valid preprocessor `#ifdef` or `#ifndef` directive. */
export class PreprocessorIfDefinition extends PreprocessorBeginIf {
  constructor(location: CodeLocation, line: string, identifier: PreprocessorToken, activeBranch: boolean | null,
    readonly wantsDefined: boolean,
  ) {
    super(location, identifier, line, activeBranch);
  }
}
function ifdefDirective(
  tokens: readonly PreprocessorToken[], diagnostics: PreprocessorDiagnostic[], activeParent: boolean,
  location: CodeLocation, line: string, macros: MacrosDefined,
  wantsDefined: boolean,
): PreprocessedOutput<PreprocessorIfDefinition | PreprocessorProblem> {
  const identifier = onlyIdentifier(tokens, diagnostics, location, line);
  if (!identifier) return PreprocessorProblem.output(location, line);
  const macroIdentifier = identifier.code;
  const activeBranch = activeParent ? macros.has(macroIdentifier) == wantsDefined : null;
  return {
    code: commentOut(line),
    construct: new PreprocessorIfDefinition(location, line, identifier, activeBranch, wantsDefined),
  };
}

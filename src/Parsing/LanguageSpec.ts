// Generic Provider Helper for ANTLR4 Parsers
import { Range, DocumentSymbol, SymbolKind, Diagnostic, SymbolTag, Uri } from 'vscode';
import {
  ErrorListener, FailedPredicateException, InputMismatchException, NoViableAltException, ParserRuleContext, TerminalNode, Token
} from 'antlr4';
import type { Lexer, Parser, ParseTree, RecognitionException } from 'antlr4';
export type ParserRule = ParserRuleContext;

interface GrammarDiagnostic<TSymbol = number | Token> {
  offendingSymbol: TSymbol;
  /** The 1-based line position. */
  line: number;
  /** The 0-based character position in the line. */
  column: number;
  msg: string;
  exception?: RecognitionException;
}
export type LexerDiagnostic = GrammarDiagnostic<number>;
export type ParserDiagnostic = GrammarDiagnostic<Token>;

export class LexerErrorListener extends ErrorListener<number> {
  diagnostics: LexerDiagnostic[] = [];
  override syntaxError(
    recognizer: Lexer, offendingSymbol: number, line: number, column: number,
    msg: string, exception?: RecognitionException
  ): void {
    this.diagnostics.push({ offendingSymbol, line, column, msg, exception });
  }
}
export class ParserErrorListener extends ErrorListener<Token> {
  diagnostics: ParserDiagnostic[] = [];
  override syntaxError(
    recognizer: Parser, offendingSymbol: Token, line: number, column: number,
    msg: string, exception?: RecognitionException
  ): void {
    this.diagnostics.push({ offendingSymbol, line, column, msg, exception });
  }
}

const uriAntlr = 'https://www.antlr.org/api/Java/org/antlr/v4/runtime/';
const uriNoViableAlt = Uri.parse(uriAntlr + 'NoViableAltException.html', true);
const uriFailedPredicate = Uri.parse(uriAntlr + 'FailedPredicateException.html', true);
const uriInputMismatch = Uri.parse(uriAntlr + 'InputMismatchException.html', true);
const uriRecognitionErr = Uri.parse(uriAntlr + 'RecognitionException.html', true);
function grammarErrorType(prefix: string, exception?: RecognitionException) {
  switch (exception?.constructor) {
    case NoViableAltException: return { value: prefix + 'NoViableAlt', target: uriNoViableAlt };
    case FailedPredicateException: return { value: prefix + 'FailedPredicate', target: uriFailedPredicate };
    case InputMismatchException: return { value: prefix + 'InputMismatch', target: uriInputMismatch };
    default: return { value: prefix + 'RecognitionErr', target: uriRecognitionErr };
  }
}

export function diagnosticsFromGrammar(
  model: { lexerDiagnostics: LexerDiagnostic[]; parserDiagnostics: ParserDiagnostic[]; },
  sourcemap: (
    d: GrammarDiagnostic, errType: string | { value: string, target: Uri; }, length: number, msg: string
  ) => Diagnostic,
  documentDiagnostics: Diagnostic[] = [],
) {
  for (const d of model.lexerDiagnostics) {
    const offendingText = / at: '([^]*)'$/.exec(d.msg)?.[1] ?? '';
    const symbolNum = d.offendingSymbol == null ? '' : ' on #' + d.offendingSymbol;
    const msg = `Lexical Error${symbolNum}: ${d.msg}`;
    documentDiagnostics.push(sourcemap(d, grammarErrorType('L', d.exception), offendingText.length, msg));
  }
  for (const d of model.parserDiagnostics) {
    const offendingText = d.offendingSymbol.text;
    const msg = `Syntax Error: ${d.msg}`;
    documentDiagnostics.push(sourcemap(d, grammarErrorType('S', d.exception), offendingText.length, msg));
  }
  return documentDiagnostics;
}

export interface DefinitionConstruct {
  kind: SymbolKind;
  id: ParseTree | Token | string | null;
  detail: string;
  range?: ParseTree | Token;
  isDeprecated?: boolean;
}

function treeRange(tree: any) {
  if (tree instanceof Token) return tokenRange(tree);
  if (tree instanceof TerminalNode) return terminalRange(tree);
  if (tree instanceof ParserRuleContext) return ruleRange(tree);
  return null;
}
function ruleRange(tree: ParserRuleContext) {
  const t0 = tree.start, t1 = tree.stop ?? tree.start;
  const l0 = t0.line - 1, c0 = t0.column;
  const l1 = t1.line - 1, c1 = t1.column, n1 = 1 + t1.stop - t1.start;
  return new Range(l0, c0, l1, c1 + n1);
}
function terminalRange(tree: TerminalNode) {
  return tokenRange(tree.symbol);
}
function tokenRange(symbol: Token) {
  const l = symbol.line - 1, c = symbol.column, n = 1 + symbol.stop - symbol.start;
  return new Range(l, c, l, c + n);
}

export default abstract class LanguageSpec {
  abstract parserDefinitions(tree: ParserRule): DefinitionConstruct[] | null | string;
  abstract sourcemap(range: Range): Range | null;
  addParserSymbols(tree: ParseTree, symbols: DocumentSymbol[]): void {
    let symbol: DocumentSymbol;
    if (!(tree instanceof ParserRuleContext)) return;
    const branches = tree.children ?? [];
    const subSymbols: DocumentSymbol[] = [];
    for (const child of branches) {
      this.addParserSymbols(child, subSymbols);
    }
    const defConstructs = this.parserDefinitions(tree);
    if (defConstructs == null) {
      symbols.push(...subSymbols); // excluding a rule means any sub-symbols it may have are promoted to its level
      return; // but the rule itself is not included
    }
    if (typeof defConstructs == 'string') {
      const range = this.sourcemap(ruleRange(tree));
      if (!range) return;
      const ruleName = tree.constructor.name.replace(/Context$/, '');
      symbol = new DocumentSymbol(defConstructs, ruleName, SymbolKind.Object, range, range);
      symbol.children = subSymbols;
      symbols.push(symbol);
      return;
    }
    let range;
    for (const defConstruct of defConstructs) {
      const id = defConstruct.id;
      const constructName = typeof id == 'string' ? id
        : id instanceof Token ? id.text : id?.getText() ?? '-';
      const subRangeOutput = treeRange(defConstruct.range);
      const subRange = subRangeOutput ? this.sourcemap(subRangeOutput)
        : (range === undefined ? range = this.sourcemap(ruleRange(tree)) : range);
      if (!subRange) continue;
      const idRangeOutput = treeRange(id);
      const idRange = idRangeOutput ? this.sourcemap(idRangeOutput) : subRange;
      if (!idRange) continue;
      symbol = new DocumentSymbol(constructName, defConstruct.detail, defConstruct.kind, subRange, idRange);
      if (defConstruct.isDeprecated) symbol.tags = [SymbolTag.Deprecated];
      symbol.children = subSymbols;
      symbols.push(symbol);
    }
  }
}
export function verboseParserDefinitions(tree: ParserRuleContext): string {
  const t0 = tree.start;
  return t0 == tree.stop ? t0.text : t0.text + '…';
}

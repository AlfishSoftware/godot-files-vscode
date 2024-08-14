// Generic Provider Helper for ANTLR4 Parsers
import { Range, DocumentSymbol, SymbolKind, Diagnostic, DiagnosticSeverity, SymbolTag } from 'vscode';
import { ErrorListener, ParserRuleContext, TerminalNode, Token } from 'antlr4';
import type { Lexer, Parser, ParseTree, RecognitionException } from 'antlr4';

interface GrammarDiagnostic<TSymbol = number | Token> {
  offendingSymbol: TSymbol;
  line: number;
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

function diagnosticFromGrammar(d: GrammarDiagnostic, offendingText: string, msgPrefix: string) {
  const n = offendingText.length; // UTF-16 char units
  //const n = [...offendingText].length; // Unicode code points
  const line = d.line - 1;
  const range = new Range(line, d.column, line, d.column + n);
  return new Diagnostic(range, msgPrefix + d.msg, DiagnosticSeverity.Error);
}
export function diagnosticsFromGrammar(
  model: { lexerDiagnostics: LexerDiagnostic[]; parserDiagnostics: ParserDiagnostic[]; },
  documentDiagnostics: Diagnostic[] = [],
) {
  for (const d of model.lexerDiagnostics) {
    const offendingText = / at: '([^]*)'$/.exec(d.msg)?.[1] ?? '';
    const symbolNum = d.offendingSymbol == null ? '' : ' on #' + d.offendingSymbol;
    const msgPrefix = `Lexical Error${symbolNum}: `;
    documentDiagnostics.push(diagnosticFromGrammar(d, offendingText, msgPrefix));
  }
  for (const d of model.parserDiagnostics) {
    const offendingText = d.offendingSymbol.text;
    const msgPrefix = `Syntax Error: `;
    documentDiagnostics.push(diagnosticFromGrammar(d, offendingText, msgPrefix));
  }
  return documentDiagnostics;
}

interface DefinitionConstruct {
  kind: SymbolKind;
  id: ParseTree | Token | string | null;
  detail: string;
  range?: ParseTree | Token;
  isDeprecated?: boolean;
}
type DefinitionConstructsSpec = (tree: ParserRuleContext) => DefinitionConstruct[] | null | string;

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

export function pushSymbols(
  tree: ParseTree, symbols: DocumentSymbol[], defConstructsSpec: DefinitionConstructsSpec,
) {
  let symbol: DocumentSymbol;
  if (!(tree instanceof ParserRuleContext)) return;
  const branches = tree.children ?? [];
  const subSymbols: DocumentSymbol[] = [];
  for (const child of branches) {
    pushSymbols(child, subSymbols, defConstructsSpec);
  }
  const range = ruleRange(tree);
  const defConstructs = defConstructsSpec(tree);
  if (typeof defConstructs == 'string') {
    const ruleName = tree.constructor.name.replace(/Context$/, '');
    symbol = new DocumentSymbol(defConstructs, ruleName, SymbolKind.Object, range, range);
    symbol.children = subSymbols;
    symbols.push(symbol);
    return;
  }
  if (!defConstructs) {
    symbols.push(...subSymbols); // excluding a rule means any sub-symbols it may have are promoted to its level
    return; // but the rule itself is not included
  }
  for (const defConstruct of defConstructs) {
    const id = defConstruct.id;
    const constructName = typeof id == 'string' ? id
      : id instanceof Token ? id.text : id?.getText() ?? '<anonymous>';
    const subRange = treeRange(defConstruct.range) ?? range;
    const idRange = treeRange(id) ?? subRange;
    symbol = new DocumentSymbol(constructName, defConstruct.detail, defConstruct.kind, subRange, idRange);
    if (defConstruct.isDeprecated) symbol.tags = [SymbolTag.Deprecated];
    symbol.children = subSymbols;
    symbols.push(symbol);
  }
}
export function verboseDefConstructsSpec(tree: ParserRuleContext): string {
  const t0 = tree.start;
  return t0 == tree.stop ? t0.text : t0.text + '…';
}

// GDShader Model
import { workspace } from 'vscode';
import { CharStream, CommonTokenStream } from 'antlr4';
import GDShaderLexer from './.antlr/GDShaderLexer';
import GDShaderParser from './.antlr/GDShaderParser';
import type * as gds from './.antlr/GDShaderParser';
import { LexerDiagnostic, LexerErrorListener, ParserDiagnostic, ParserErrorListener } from '../Parsing/LanguageSpec';

export default class GDShaderModel {
  tree: gds.AShaderCodeContext | null;
  lexerDiagnostics: LexerDiagnostic[];
  parserDiagnostics: ParserDiagnostic[];
  constructor(preprocessedCode: string, runParser: boolean) {
    // VSCode diagnostics positions count UTF-16 units, even though navigation positions count code points.
    // Thus, we need to disable decodeToUnicodeCodePoints to correctly position error squiggles.
    //const chars = new CharStream(code, true); // Unicode code points
    const chars = new CharStream(preprocessedCode, false); // UTF-16 char units
    const lexer = new GDShaderLexer(chars);
    lexer.removeErrorListeners();
    const lexerErrors = new LexerErrorListener();
    lexer.addErrorListener(lexerErrors);
    const tokens = new CommonTokenStream(lexer);
    if (runParser) {
      const parser = new GDShaderParser(tokens);
      parser.removeErrorListeners();
      const parserErrors = new ParserErrorListener();
      parser.addErrorListener(parserErrors);
      this.tree = parser.aShaderCode(); // run lexer and parser
      this.parserDiagnostics = parserErrors.diagnostics;
      if (workspace.getConfiguration('godotFiles').get('_debug_.godotShaderLogParseTree', false))
        console.log(this.tree.toStringTree(null, parser));
    } else {
      lexer.getAllTokens(); // run only lexer
      this.tree = null;
      this.parserDiagnostics = [];
    }
    this.lexerDiagnostics = lexerErrors.diagnostics;
  }
}

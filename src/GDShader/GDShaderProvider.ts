// GDShader Features
import {
  languages, workspace, Uri, FileType, ExtensionContext, CancellationToken, Range,
  TextDocument, DocumentSymbol, SymbolKind, DocumentFilter, DocumentSymbolProvider,
  Diagnostic, DiagnosticSeverity, DiagnosticRelatedInformation,
} from 'vscode';
import { locateResPath } from '../GodotProject';
import GDShaderModel from './GDShaderModel';
import LanguageSpec, { ParserRule, DefinitionConstruct, diagnosticsFromGrammar } from '../Parsing/LanguageSpec';
import GDShaderPreprocessorBase, {
  CodePosition, MappedLocation, preprocessorErrorTypes,
  PreprocessingFile, PreprocessorDiagnostic, PreprocessedUnit, PreprocessorDirective, PreprocessorInclude,
} from './GDShaderPreprocessor';
import * as gds from './.antlr/GDShaderParser';
const toUTF8 = new TextDecoder();

function ideRange(start: CodePosition, end: CodePosition): Range {
  return new Range(start.line - 1, start.column, end.line - 1, end.column);
}

class GDShaderPreprocessor extends GDShaderPreprocessorBase {
  override async loader(loadPath: string, fromUri: string): Promise<PreprocessingFile> {
    const toUri = await locateResPath(loadPath, Uri.parse(fromUri, true));
    if (typeof toUri == 'string')
      throw `file not found at: "${toUri}";\nloading from "${fromUri}"`;
    const { uri, stat } = toUri;
    if (stat.type & FileType.Directory)
      throw `found directory instead of file at: "${uri.toString(true)}";\nloading from "${fromUri}"`;
    const uriStr = uri.toString();
    const document = workspace.textDocuments.find(d =>
      d.languageId == languageIdGodotShader && d.uri.toString() == uriStr);
    const code = document?.getText() ?? toUTF8.decode(await workspace.fs.readFile(uri));
    return { uri: uriStr, code };
  }
  pushDiagnostics(diagnostics: PreprocessorDiagnostic[]): Diagnostic[] {
    const documentDiagnostics: Diagnostic[] = [];
    for (const d of diagnostics) {
      const location = d.location;
      const range = ideRange(location.start, location.end);
      let msg = 'Preprocessor Error: ' + d.msg;
      const diagnostic = new Diagnostic(range, msg, DiagnosticSeverity.Error);
      diagnostic.source = 'gdshader';
      const errCode = d.id;
      if (errCode) diagnostic.code = { value: errCode, target: Uri.parse(preprocessorErrorTypes[errCode], true) };
      const info: DiagnosticRelatedInformation[] = [];
      for (let cause = d.cause; cause; cause = cause.cause) {
        const { location } = cause;
        const uri = Uri.parse(location.uri, true), range = ideRange(location.start, location.end);
        info.push({ message: cause.msg, location: { uri, range } });
      }
      diagnostic.relatedInformation = info;
      documentDiagnostics.push(diagnostic);
    }
    return documentDiagnostics;
  }
}
function mapRange(length: number, loc: MappedLocation): Range {
  const { inputPosition, replacement, unit } = loc;
  const a = unit.inputPositionAt(inputPosition);
  const b = unit.inputPositionAt(inputPosition + (replacement ? loc.inputLength : length));
  return ideRange(a, b);
}

const languageIdGodotShader = 'godot-shader';
export default class GDShaderProvider implements
  DocumentSymbolProvider
{
  static documentFilter: DocumentFilter[] = [
    { language: languageIdGodotShader },
  ];
  diagnostics;
  constructor(ctx: ExtensionContext) {
    ctx.subscriptions.push(
      languages.registerDocumentSymbolProvider(GDShaderProvider.documentFilter, this),
      this.diagnostics = languages.createDiagnosticCollection('godot-shader'),
    );
  }
  models: { [uri: string]: GDShaderModel | undefined; } = {};
  async provideDocumentSymbols(document: TextDocument, _token: CancellationToken): Promise<DocumentSymbol[]> {
    const uri = document.uri.toString(true);
    const entryCode = document.getText();
    // Preprocess code
    const preprocessor = new GDShaderPreprocessor();
    //FIXME temporary code to set all macros, just to test expansions
    for (const m of entryCode.matchAll(/^[ \t]*#define +(\w+\b) *(?:\( *((?:\w+ *, *)*\w*) *\))? *(.*?)$/mg)) {
      const p = m[2];
      const parameters = p == null ? null : /^\s*$/.test(p) ? [] : p.split(/\s*,\s*/g);
      preprocessor.macros.set(m[1]!, { parameters, code: m[3]! });
      console.log(`Using macro def: ${m[1]!} :: ${parameters} :: ${m[3]!}`);
    }
    const unit = await preprocessor.preprocess({ uri, code: entryCode });
    const { preprocessedCode } = unit;
    // Parse model
    const model = this.models[uri] = new GDShaderModel(preprocessedCode);
    // Report diagnostics
    const documentDiagnostics = preprocessor.pushDiagnostics(unit.diagnostics);
    diagnosticsFromGrammar(model, (d, errType, length, msg) => {
      const outputPosition = unit.outputOffsetAt(d.line, d.column);
      const rootLoc = unit.sourcemap(outputPosition);
      const diagnostic = new Diagnostic(mapRange(length, rootLoc), msg, DiagnosticSeverity.Error);
      diagnostic.source = 'gdshader';
      diagnostic.code = errType;
      const info: DiagnosticRelatedInformation[] = [];
      for (let subLoc = rootLoc.original; subLoc; subLoc = subLoc.original) {
        const uri = Uri.parse(subLoc.unit.input.uri, true);
        const message = 'from included file';// : 'from expanded code';
        const range = mapRange(length, subLoc);
        info.push({ message, location: { uri, range } });
      }
      diagnostic.relatedInformation = info;
      return diagnostic;
    }, documentDiagnostics);
    this.diagnostics.set(document.uri, documentDiagnostics);
    // Build outline
    const symbols: DocumentSymbol[] = [];
    const langSpec = new GDShaderLanguageSpec(unit);
    langSpec.addPreprocessorSymbols(symbols);
    langSpec.addParserSymbols(model.tree, symbols);
    return symbols;
  }
}

class GDShaderLanguageSpec extends LanguageSpec {
  unit: PreprocessedUnit
  constructor(unit: PreprocessedUnit) {
    super();
    this.unit = unit;
  }
  override sourcemap(range: Range): Range | null {
    const { start } = range, unit = this.unit;
    const outputStart = unit.outputOffsetAt(start.line + 1, start.character);
    const locStart = unit.sourcemap(outputStart);
    if (locStart.original) return null; // don't add outline definition if starting from inside a #include
    const inputStart = locStart.inputPosition;
    const a = unit.inputPositionAt(inputStart); let b;
    if (locStart.replacement) b = unit.inputPositionAt(inputStart + locStart.inputLength);
    else {
      const { end } = range;
      const outputEnd = unit.outputOffsetAt(end.line + 1, end.character);
      const locEnd = unit.sourcemap(outputEnd);
      if (locEnd.original) return null; // don't add outline definition if ending from inside a #include
      const inputEnd = locEnd.inputPosition;
      b = unit.inputPositionAt(locEnd.replacement ? inputEnd + locEnd.inputLength : inputEnd);
    }
    return ideRange(a, b);
  }
  addPreprocessorSymbols(symbols: DocumentSymbol[]): void {
    for (const chunk of this.unit.chunks) {
      const { replacement } = chunk;
      if (!replacement) continue;
      const { construct } = replacement;
      if (construct instanceof PreprocessorDirective) {
        const directiveDefs = this.directiveDefinition(construct);
        if (directiveDefs) symbols.push(directiveDefs);
      }
    }
  }
  directiveDefinition(directive: PreprocessorDirective): DocumentSymbol | null {
    if (directive instanceof PreprocessorInclude) {
      const { location, mainRange } = directive;
      const range = ideRange(location.start, location.end);
      const selectionRange = ideRange(mainRange.start, mainRange.end);
      return new DocumentSymbol(directive.path, '#include', SymbolKind.File, range, selectionRange);
    }
    return null;
  }
  override parserDefinitions(tree: ParserRule): DefinitionConstruct[] | null | string {
    if (tree instanceof gds.ALocalVarDefContext
      || tree instanceof gds.AConstDefContext
      || tree instanceof gds.AStructFieldDefContext
    ) {
      let kind;
      if (tree instanceof gds.ALocalVarDefContext) kind = SymbolKind.Variable;
      else if (tree instanceof gds.AConstDefContext) kind = SymbolKind.Constant;
      else kind = SymbolKind.Field;
      const type = atomicTypeText(tree.aAtomicConstructibleType());
      const arraySize = tree.aArraySize()?.getText();
      if (arraySize) return tree._names.map(name => {
        const id =
          name instanceof gds.ANameInitContext || name instanceof gds.ANameDefContext ? name._name : name;
        return { kind, id, detail: type + arraySize, range: name };
      });
      return tree._flexileNames.map(flexileName => {
        const arraySize = flexileName.aArraySize()?.getText() ?? '';
        return { kind, id: flexileName._name, detail: type + arraySize, range: flexileName };
      });
    }
    if (tree instanceof gds.AUniformDefContext) {
      const sharing = tree._sharing?.text;
      const typeSharing = sharing ? sharing + ' ' : '';
      const type = atomicTypeText(tree.aAtomicIntrinsicType());
      const arraySize = tree.aArraySize()?.getText() ?? '';
      const hints = tree._typeHints.map(h => h.getText()).join();
      const typeHints = hints ? ':' + hints : '';
      const detail = `${typeSharing}${type}${arraySize}${typeHints}`;
      return [{ kind: SymbolKind.Property, id: tree._name, detail }];
    }
    if (tree instanceof gds.AVaryingDefContext) {
      const interpolator = tree._interpolator?.text ?? 'varying';
      const type = atomicTypeText(tree.aAtomicBasicType());
      const arraySize = tree.aArraySize()?.getText() ?? '';
      const detail = `${interpolator} ${type}${arraySize}`;
      return [{ kind: SymbolKind.Property, id: tree._name, detail }];
    }
    if (tree instanceof gds.AParameterDefContext) {
      const qualifier = tree.aDirectionalQualifier()._qualifier?.text ?? 'in';
      const type = atomicTypeText(tree.aAtomicAnyType());
      const arraySize = tree.aArraySize()?.getText() ?? '';
      const detail = `${qualifier} ${type}${arraySize}`;
      return [{ kind: SymbolKind.Variable, id: tree._name, detail }];
    }
    if (tree instanceof gds.AFunctionDefContext)
      return [{ kind: SymbolKind.Function, id: tree._name, detail: tree.aReturnType().getText() }];
    if (tree instanceof gds.AStructDefContext)
      return [{ kind: SymbolKind.Struct, id: tree._name, detail: 'struct' }];
    //TODO maybe we should not add these constructs below in outline, but still process them here anyway
    if (tree instanceof gds.AGroupUniformsContext) {
      const group = tree._group?.text; let id;
      if (group) {
        const subgroup = tree._subgroup?.text;
        id = subgroup ? `${group}.${subgroup}` : group;
      } else id = null;
      return [{ kind: SymbolKind.Namespace, id, detail: 'group_uniforms' }];
    }
    if (tree instanceof gds.ARenderModeContext)
      return tree._values.map(id => ({ kind: SymbolKind.Interface, id, detail: 'render_mode', range: id }));
    if (tree instanceof gds.AShaderTypeContext)
      return [{ kind: SymbolKind.Class, id: tree._value, detail: 'shader_type' }];
    return null;
  }
}

function atomicTypeText(type: object): string {
  if (type instanceof gds.AAtomicNamedTypeContext) return type._typeName.text;
  if (type instanceof gds.AAtomicBasicTypeContext || type instanceof gds.AAtomicSamplerTypeContext) {
    const precision = type._precision, typeWord = type._typeWord.text;
    return precision ? `${precision.text} ${typeWord}` : typeWord;
  }
  if (type instanceof gds.AAtomicConstructibleTypeContext)
    return atomicTypeText(type.aAtomicBasicType() ?? type.aAtomicNamedType());
  if (type instanceof gds.AAtomicIntrinsicTypeContext)
    return atomicTypeText(type.aAtomicBasicType() ?? type.aAtomicSamplerType());
  if (type instanceof gds.AAtomicAnyTypeContext)
    return atomicTypeText(type.aAtomicIntrinsicType() ?? type.aAtomicNamedType());
  return '';
}

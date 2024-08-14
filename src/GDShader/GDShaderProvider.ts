// GDShader Features
import {
  languages,
  ExtensionContext, CancellationToken, TextDocument, DocumentSymbol, SymbolKind, DocumentFilter, DocumentSymbolProvider,
} from 'vscode';
import GDShaderModel from './GDShaderModel';
import { diagnosticsFromGrammar, pushSymbols } from '../Parsing/LanguageSpec';
import * as gds from './.antlr/GDShaderParser';

export default class GDShaderProvider implements
  DocumentSymbolProvider
{
  static documentFilter: DocumentFilter[] = [
    { language: 'godot-shader' },
  ];
  diagnostics;
  constructor(ctx: ExtensionContext) {
    ctx.subscriptions.push(
      languages.registerDocumentSymbolProvider(GDShaderProvider.documentFilter, this),
      this.diagnostics = languages.createDiagnosticCollection('gdshader'),
    );
  }
  models: { [uri: string]: GDShaderModel | undefined; } = {};
  async provideDocumentSymbols(document: TextDocument, _token: CancellationToken): Promise<DocumentSymbol[]> {
    const code = document.getText();
    const model = this.models[document.uri.toString(true)] = new GDShaderModel(code);
    const documentDiagnostics = diagnosticsFromGrammar(model);
    this.diagnostics.set(document.uri, documentDiagnostics);
    const symbols: DocumentSymbol[] = [];
    pushSymbols(model.tree, symbols, tree => {
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
    });
    return symbols;
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

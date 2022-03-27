import * as vscode from 'vscode';
function escapeReplacement(s: string) { return s.replace(/\$/g, '$$$$'); }

class GDAsset {
  rootNode: string | undefined = undefined;
  nodePath(n: string) {
    return this.rootNode ? n.replace(/^\.(?=\/|$)/, escapeReplacement(this.rootNode)) : n;
  }
}

function makeSectionSymbol(
  document: vscode.TextDocument,
  match: RegExpMatchArray,
  line: vscode.TextLine,
  gdasset: GDAsset,
) {
  const [, header, tag, rest] = match;
  const attributes: { [field: string]: string | undefined } = {};
  for (const assignment of rest.matchAll(/\b([\w-]+)\b\s*=\s*(?:(\d+)|"([^"]*)")/g))
    attributes[assignment[1]] = assignment[2] ?? GDAssetProvider.unescapeString(assignment[3]);
  let name: string, detail, kind;
  switch (tag) {
    case 'gd_scene':
      name = document.uri.path.replace(/^\/(?:.*\/)*(.*?)(?:\.[^.]*)?$/, '$1');
      detail = 'PackedScene';
      kind = vscode.SymbolKind.File;
      break;
    case 'gd_resource':
      name = document.uri.path.replace(/^\/(.*\/)*/, '');
      detail = attributes.type;
      kind = vscode.SymbolKind.File;
      break;
    case 'ext_resource':
      name = attributes.path ?? tag;
      detail = attributes.type;
      kind = vscode.SymbolKind.Variable;
      break;
    case 'sub_resource':
      name = '::' + attributes.id;
      detail = attributes.type;
      kind = vscode.SymbolKind.Object;
      break;
    case 'node':
      if (attributes.parent == undefined)
        name = (gdasset.rootNode = attributes.name) ?? tag;
      else name = gdasset.nodePath(attributes.parent) + '/' + attributes.name;
      detail = attributes.type;
      kind = vscode.SymbolKind.Object;
      break;
    case 'connection':
      if (attributes.from && attributes.to && attributes.method)
        name = `${gdasset.nodePath(attributes.from)}→${gdasset.nodePath(attributes.to)}::${attributes.method}`;
      else name = tag;
      detail = attributes.signal;
      kind = vscode.SymbolKind.Event;
      break;
    default:
      name = tag;
      detail = rest;
      kind = vscode.SymbolKind.Object;
      break;
  }
  return new vscode.DocumentSymbol(name, detail ?? '', kind, line.range, line.range);
}

class GDAssetProvider implements vscode.DocumentSymbolProvider {
  static docs: vscode.DocumentSelector = ['gdasset', 'config-definition'];
  
  public static unescapeString(partInsideQuotes: string) {
    let s = '';
    for (const m of partInsideQuotes.matchAll(/\\(["ntr\\bf]|u[0-9A-Fa-f]{4})|\\$|\\?([^])/g)) {
      switch (m[1]) {
        case '\\': case '"': s += m[1]; continue;
        case 'n': s += '\n'; continue;
        case 't': s += '\t'; continue;
        case 'r': s += '\r'; continue;
        case 'b': s += '\b'; continue;
        case 'f': s += '\f'; continue;
        case undefined: case null: case '': s += m[2] ?? ''; continue;
        default: s += String.fromCharCode(parseInt(m[1].substring(1), 16)); continue; // uXXXX
      }
    }
    return s;
  }
  
  public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    const gdasset = document.languageId == 'gdasset' ? new GDAsset() : null;
    let previousLine: vscode.TextLine | undefined;
    let currentSection: vscode.DocumentSymbol | undefined;
    let currentProperty: vscode.DocumentSymbol | null = null;
    const symbols = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      let match = line.text.match(
        /^(\[\s*([\p{L}\w-]+(?:\s+[\p{L}\w-]+|\s+"[^"\\]*")*(?=\s*\])|[^\[\]\s]+)\s*(.*?)\s*\])\s*([;#].*)?$/u
      );
      if (match) {
        // Section Header
        if (currentSection && previousLine)
          currentSection.range = new vscode.Range(currentSection.range.start, previousLine.range.end);
        if (gdasset)
          currentSection = makeSectionSymbol(document, match, line, gdasset);
        else {
          const [, header, tag, rest] = match;
          currentSection = new vscode.DocumentSymbol(tag, rest, vscode.SymbolKind.Object, line.range, line.range);
        }
        symbols.push(currentSection);
        currentProperty = null;
      } else if (match = line.text.match(
        /^(((?:[\p{L}\w-]+[./])*[\p{L}\w-]+)(?:\s*\[([\w\\/.:!@$%+-]+)\])?)\s*=/u
      )) {
        // Property Assignment
        const [, prop, key, index] = match;
        let s = currentSection?.children ?? symbols;
        if (index) {
          const p = `${key}[]`;
          let parentProp = s.find(value => value.name == p);
          if (!parentProp)
            s.push(parentProp = new vscode.DocumentSymbol(p, '', vscode.SymbolKind.Array, line.range, line.range));
          parentProp.range = new vscode.Range(parentProp.range.start, line.range.end);
          s = parentProp.children;
        }
        if (currentSection)
          currentSection.range = new vscode.Range(currentSection.range.start, line.range.end);
        currentProperty = new vscode.DocumentSymbol(prop, '', vscode.SymbolKind.Property, line.range, line.range);
        s.push(currentProperty);
      } else if (currentProperty && !/^\s*(?:[;#].*)?$/.test(line.text)) {
        // Still in value of previous property
        currentProperty.range = new vscode.Range(currentProperty.range.start, line.range.end);
      }
      previousLine = line;
    }
    if (currentSection && previousLine)
      currentSection.range = new vscode.Range(currentSection.range.start, previousLine.range.end);
    return symbols;
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GDAssetProvider.docs, new GDAssetProvider()));
}

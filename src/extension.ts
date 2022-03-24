import * as vscode from 'vscode';
function escapeReplacement(s: string) { return s.replace(/\$/g, '$$$$'); }

class GDAssetProvider implements vscode.DocumentSymbolProvider {
  static docs: vscode.DocumentSelector = 'gdasset';
  
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
    let rootNode: string | undefined;
    function nodePath(n: string) {
      return rootNode ? n.replace(/^\.(?=\/|$)/, escapeReplacement(rootNode)) : n;
    }
    const symbols = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const match =
        line.text.match(/^\s*(\[\s*([^\[\]\s]+)\s*(.*?)\s*\])\s*([;#].*)?$/);
      if (match) {
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
              name = (rootNode = attributes.name) ?? tag;
            else name = nodePath(attributes.parent) + '/' + attributes.name;
            detail = attributes.type;
            kind = vscode.SymbolKind.Object;
            break;
          case 'connection':
            if (attributes.from && attributes.to && attributes.method)
              name = `${nodePath(attributes.from)}→${nodePath(attributes.to)}::${attributes.method}`;
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
        symbols.push(new vscode.DocumentSymbol(name, detail ?? '', kind, line.range, line.range));
      }
    }
    return symbols;
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GDAssetProvider.docs, new GDAssetProvider()));
}

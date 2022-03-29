import * as vscode from 'vscode';
function escapeReplacement(s: string) { return s.replace(/\$/g, '$$$$'); }

class GDAsset {
  rootNode: string | undefined = undefined;
  nodePath(n: string) {
    return this.rootNode ? n.replace(/^\.(?=\/|$)/, escapeReplacement(this.rootNode)) : n;
  }
  ids = {
    ExtResource: [] as (vscode.DocumentSymbol | undefined)[],
    SubResource: [] as (vscode.DocumentSymbol | undefined)[],
  };
}

function makeSectionSymbol(
  document: vscode.TextDocument,
  match: RegExpMatchArray,
  line: vscode.TextLine,
  gdasset: GDAsset,
) {
  const [, header, tag, rest] = match;
  const attributes: { [field: string]: string | undefined; } = {};
  let id;
  for (const assignment of rest.matchAll(/\b([\w-]+)\b\s*=\s*(?:(\d+)|"([^"]*)")/g)) {
    if (assignment[1] == 'id' && assignment[2]) id = +assignment[2];
    attributes[assignment[1]] = assignment[2] ?? GDAssetProvider.unescapeString(assignment[3]);
  }
  let s = new vscode.DocumentSymbol(tag, rest, vscode.SymbolKind.Object, line.range, line.range);
  switch (tag) {
    case 'gd_scene':
      s.name = document.uri.path.replace(/^\/(?:.*\/)*(.*?)(?:\.[^.]*)?$/, '$1');
      s.detail = 'PackedScene';
      s.kind = vscode.SymbolKind.File;
      break;
    case 'gd_resource':
      s.name = document.uri.path.replace(/^\/(.*\/)*/, '');
      s.detail = attributes.type ?? '';
      s.kind = vscode.SymbolKind.File;
      break;
    case 'ext_resource':
      if (id)
        gdasset.ids.ExtResource[id] = s;
      s.name = attributes.path ?? tag;
      s.detail = attributes.type ?? '';
      s.kind = vscode.SymbolKind.Variable;
      break;
    case 'sub_resource':
      if (id) {
        gdasset.ids.SubResource[id] = s;
        s.name = '::' + id;
      }
      s.detail = attributes.type ?? '';
      break;
    case 'node':
      if (attributes.parent == undefined)
        s.name = (gdasset.rootNode = attributes.name) ?? tag;
      else s.name = gdasset.nodePath(attributes.parent) + '/' + attributes.name;
      s.detail = attributes.type ?? '';
      break;
    case 'connection':
      if (attributes.from && attributes.to && attributes.method)
        s.name = `${gdasset.nodePath(attributes.from)}→${gdasset.nodePath(attributes.to)}::${attributes.method}`;
      else s.name = tag;
      s.detail = attributes.signal ?? '';
      s.kind = vscode.SymbolKind.Event;
      break;
  }
  return s;
}

class GDAssetProvider implements
  vscode.DocumentSymbolProvider,
  vscode.DefinitionProvider,
  vscode.HoverProvider
{
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
  
  defs: { [uri: string]: GDAsset | undefined } = {};
  
  async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    const gdasset = document.languageId != 'gdasset' ? null :
      this.defs[document.uri.toString(true)] = new GDAsset();
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
  
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken
  ): Promise<vscode.Definition | null> {
    if (document.languageId != 'gdasset') return null;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    let match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(\d+)\s*\)$/);
    if (match) {
      const keyword = match[1] as 'ExtResource' | 'SubResource';
      const id = +match[2];
      const gdasset = this.defs[document.uri.toString(true)];
      if (!gdasset) return null;
      const s = gdasset.ids[keyword][id];
      if (!s) return null;
      if (keyword == 'ExtResource') {
        let d = document.getText(s.selectionRange).indexOf(' path="');
        d = d < 0 ? 0 : d + 7;
        return new vscode.Location(document.uri, s.range.start.translate(0, d));
      }
      return new vscode.Location(document.uri, s.range);
    } else if (match = word.match(/^"res:\/\/([^"\\]*)"$/)) {
      let resUri = await resPathToUri(match[1], document);
      if (resUri instanceof vscode.Uri) return new vscode.Location(resUri, new vscode.Position(0, 0));
    }
    return null;
  }
  
  async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    if (document.languageId != 'gdasset') return null;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    let match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(\d+)\s*\)$/);
    let hover = [], resPath;
    if (match) {
      const keyword = match[1] as 'ExtResource' | 'SubResource';
      const id = +match[2];
      const gdasset = this.defs[document.uri.toString(true)];
      if (!gdasset) return null;
      const s = gdasset.ids[keyword][id];
      if (!s) return null;
      const md = new vscode.MarkdownString();
      if (/^::\d+$/.test(s.name)) {
        resPath = await resPathOfDocument(document);
        resPath = resPath ? 'res://' + resPath : document.uri.path.replace(/(?:.*\/)+/, '');
        md.appendCodeblock(`preload("${resPath}::${id}") as ${s.detail}`, 'gdscript');
        return new vscode.Hover(md, wordRange);
      }
      resPath = s.name.substring(6);
      md.appendCodeblock(`preload("${s.name}") as ${s.detail}`, 'gdscript');
      hover.push(md);
    } else if (match = word.match(/^"res:\/\/([^"\\]*)"$/)) {
      resPath = match[1];
    } else return null;
    // show link to res:// path if available
    hover.push(await resPathToMarkdown(resPath, document));
    return new vscode.Hover(hover, wordRange);
  }
}

async function resPathOfDocument(document: vscode.TextDocument) {
  //TODO function: use document.uri and go up until project.godot is found
  const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspace) return null;
  const projUri = workspace.uri.with({ path: workspace.uri.path + '/project.godot' });
  try {
    const projStat = vscode.workspace.fs.stat(projUri);
    await projStat;
  } catch {
    return null;
  }
  return vscode.workspace.asRelativePath(document.uri, false);
}
async function resPathToUri(resPath: string, document: vscode.TextDocument) {
  //TODO function: use document.uri and go up until project.godot is found
  const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspace) return null;
  const resUri = workspace.uri.with({ path: workspace.uri.path + '/' + resPath });
  const projUri = workspace.uri.with({ path: workspace.uri.path + '/project.godot' });
  try {
    const projStat = vscode.workspace.fs.stat(projUri);
    const resStat = vscode.workspace.fs.stat(resUri);
    await projStat; await resStat;
  } catch {
    return resUri.toString();
  }
  return resUri;
}
async function resPathToMarkdown(resPath: string, document: vscode.TextDocument) {
  const resUri = await resPathToUri(resPath, document);
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  if (!(resUri instanceof vscode.Uri))
    return md.appendMarkdown(`<div title="${resUri ?? ''}">File not found</div>`);
  if (/\.(svg|png|gif|jpe?g|bmp)$/.test(resPath))
    return md.appendMarkdown(`[<img height=128 src="${resUri}"/>](${resUri})`);
  return md.appendMarkdown(`[Open file](${resUri})`);
}

export function activate(ctx: vscode.ExtensionContext) {
  let provider = new GDAssetProvider(), docs = GDAssetProvider.docs;
  ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(docs, provider));
  ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(docs, provider));
  ctx.subscriptions.push(vscode.languages.registerHoverProvider(docs, provider));
}

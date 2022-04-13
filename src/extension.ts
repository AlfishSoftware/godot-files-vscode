import * as vscode from 'vscode';
function escapeReplacement(s: string) { return s.replace(/\$/g, '$$$$'); }

class GDAsset {
  rootNode: string | undefined = undefined;
  nodePath(n: string) {
    if (!this.rootNode || !n) return n;
    return n == '.' ? this.rootNode : `${this.rootNode}/${n}`;
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
      s.kind = vscode.SymbolKind.File;
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
  static docs: vscode.DocumentSelector = [
    'godot-project',
    'godot-resource',
    'godot-scene',
    'godot-asset',
    'config-definition',
  ];
  
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
    const gdasset = document.languageId == 'config-definition' ? null :
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
        /^\s*(((?:[\p{L}\w-]+[./])*[\p{L}\w-]+)(?:\s*\[([\w\\/.:!@$%+-]+)\])?)\s*=/u
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
      //TODO detect string start and eat it until end
      previousLine = line;
    }
    if (currentSection && previousLine)
      currentSection.range = new vscode.Range(currentSection.range.start, previousLine.range.end);
    return symbols;
  }
  
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken
  ): Promise<vscode.Definition | null> {
    if (document.languageId == 'config-definition') return null;
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
    } else if (isResPath(word, wordRange, document)) {
      let resUri = await resPathToUri(word, document);
      if (resUri instanceof vscode.Uri) return new vscode.Location(resUri, new vscode.Position(0, 0));
    }
    return null;
  }
  
  async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    if (document.languageId == 'config-definition') return null;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    let hover = [], resPath, match;
    if (word == 'ext_resource' || isResPath(word, wordRange, document)) {
      const line = document.lineAt(position).text;
      match = /^\[\s*ext_resource\s+path\s*=\s*"([^"\\]*)"\s*type\s*=\s*"([^"\\]*)"/.exec(line);
      if (word == 'ext_resource') {
        if (!match) return null;
        resPath = match[1];
      } else resPath = word;
      hover.push(preloadMarkdown(resPath, match ? match[2] : null));
    } else if (word == 'sub_resource') {
      const line = document.lineAt(position).text;
      match = /^\[\s*sub_resource\s+type\s*=\s*"([^"\\]*)"\s*id\s*=\s*(\d+)\b/.exec(line);
      if (!match) return null;
      const [, type, id] = match;
      resPath = await resPathOfDocument(document);
      return new vscode.Hover(preloadMarkdown(`${resPath}::${id}`, type), wordRange);
    } else if (word == 'gd_resource') {
      const line = document.lineAt(position).text;
      match = /^\[\s*gd_resource\s+type\s*=\s*"([^"\\]*)"/.exec(line);
      if (!match) return null;
      return new vscode.Hover(preloadMarkdown(await resPathOfDocument(document), match[1]), wordRange);
    } else if (word == 'gd_scene') {
      const line = document.lineAt(position).text;
      match = /^\[\s*gd_scene\b/.exec(line);
      if (!match) return null;
      return new vscode.Hover(preloadMarkdown(await resPathOfDocument(document), 'PackedScene'), wordRange);
    } else if (match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(\d+)\s*\)$/)) {
      const keyword = match[1] as 'ExtResource' | 'SubResource';
      const id = +match[2];
      const gdasset = this.defs[document.uri.toString(true)];
      if (!gdasset) return null;
      const s = gdasset.ids[keyword][id];
      if (!s) return null;
      const md = new vscode.MarkdownString();
      if (keyword == 'SubResource') {
        resPath = await resPathOfDocument(document);
        md.appendCodeblock(`preload("${resPath}::${id}") as ${s.detail}`, 'gdscript');
        return new vscode.Hover(md, wordRange);
      }
      resPath = s.name;
      md.appendCodeblock(`preload("${resPath}") as ${s.detail}`, 'gdscript');
      hover.push(md);
    } else return null;
    // show link to res:// path if available
    hover.push(await resPathToMarkdown(resPath, document));
    return new vscode.Hover(hover, wordRange);
  }
}

function isResPath(word: string, wordRange: vscode.Range, document: vscode.TextDocument) {
  if (/^res:\/\/[^"\\]*$/.test(word)) return true;
  const r = new vscode.Range(wordRange.start.line, 0, wordRange.end.line, wordRange.end.character + 1);
  return /(?<=^\[\s*ext_resource\s+path\s*=\s*")[^"\\]*(?="$)/.test(document.getText(r));
}
function preloadMarkdown(resPath: string, type?: string | null) {
  let code = `preload("${resPath}")`;
  if (type) code += ` as ${type}`;
  return new vscode.MarkdownString().appendCodeblock(code, 'gdscript');
}
async function resPathOfDocument(document: vscode.TextDocument) {
  //TODO function: use document.uri and go up until project.godot is found
  const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
  if (workspace) {
    const projUri = vscode.Uri.joinPath(workspace.uri, 'project.godot');
    try {
      await vscode.workspace.fs.stat(projUri);
      return 'res://' + vscode.Uri.file(vscode.workspace.asRelativePath(document.uri, false)).path;
    } catch { }
  }
  return document.uri.path.replace(/^(?:.*\/)+/, ''); // fallback to document file name (relative path)
}
const uriRegex = /^[a-zA-Z][a-zA-Z0-9.+-]*:\/\/[^\x00-\x1F "<>\\^`{|}\x7F-\x9F]*$/;
async function resPathToUri(resPath: string, document: vscode.TextDocument) {
  let resUri, resStat;
  if (resPath.startsWith('res://')) {
    //TODO function: use document.uri and go up until project.godot is found
    const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspace) return resPath;
    const projStat = vscode.workspace.fs.stat(vscode.Uri.joinPath(workspace.uri, 'project.godot'));
    resUri = vscode.Uri.joinPath(workspace.uri, resPath.substring(6));
    resStat = vscode.workspace.fs.stat(resUri);
    try { await projStat; } catch {
      return resPath;
    }
  } else {
    if (uriRegex.test(resPath))
      return resPath; // better not to load arbitrary URI schemes like http, etc
    resUri = vscode.Uri.joinPath(document.uri, '..', resPath); // path is relative to folder of document
    resStat = vscode.workspace.fs.stat(resUri);
  }
  try { await resStat; } catch {
    return resUri.toString();
  }
  return resUri;
}
const fontTest = `\
<tspan>JFK GOT MY VHS, PC AND XLR WEB QUIZ</tspan>
<tspan x="0" y="20">new job: fix mr. gluck's hazy tv pdq!</tspan>
<tspan x="0" y="40">Oo0 Ili1 Zz2 3 A4 S5 G6 T7 B8 g9</tspan>`;
async function resPathToMarkdown(resPath: string, document: vscode.TextDocument) {
  const resUri = await resPathToUri(resPath, document);
  const md = new vscode.MarkdownString();
  md.supportHtml = true;
  if (!(resUri instanceof vscode.Uri))
    return md.appendMarkdown(`<div title="${resUri}">File not found</div>`);
  if (/\.(svg|png|gif|jpe?g|bmp)$/.test(resPath))
    return md.appendMarkdown(`[<img height=128 src="${resUri}"/>](${resUri})`);
  let match = /\.(ttf|otf|woff)$/.exec(resPath);
  if (match) {
    const bytes = await vscode.workspace.fs.readFile(resUri);
    const dataUrl = `data:font/${match[1]};base64,${Buffer.from(bytes).toString('base64')}`;
    const t = encodeURIComponent(fontTest).replace("'", "%27");
    return md.appendMarkdown(`[<img src='data:image/svg+xml,\
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80" style="background:white;margin:4px"><style>\
@font-face{font-family:F;src:url("${dataUrl}")}\
text{font-family:F;dominant-baseline:text-before-edge}\
</style><text>${t}</text></svg>'/>](${resUri})`);
  }
  return md.appendMarkdown(`[Open file](${resUri})`);
}

export function activate(ctx: vscode.ExtensionContext) {
  let provider = new GDAssetProvider(), docs = GDAssetProvider.docs;
  ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(docs, provider));
  ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(docs, provider));
  ctx.subscriptions.push(vscode.languages.registerHoverProvider(docs, provider));
}

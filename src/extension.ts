import * as vscode from 'vscode';
import { rmSync } from 'fs';

function hash(s: string, seed = 0) { // 53-bit hash, see https://stackoverflow.com/a/52171480
  let a = 0xdeadbeef ^ seed, b = 0x41c6ce57 ^ seed;
  for (let i = 0, c; i < s.length; i++) {
    c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return 4294967296 * (2097151 & b) + (a >>> 0);
}

class GDAsset {
  rootNode: string | undefined = undefined;
  nodePath(n: string) {
    if (!this.rootNode || !n) return n;
    return n == '.' ? this.rootNode : `${this.rootNode}/${n}`;
  }
  ids = {
    ExtResource: {} as { [id: string]: vscode.DocumentSymbol | undefined },
    SubResource: {} as { [id: string]: vscode.DocumentSymbol | undefined },
  };
  strings: { range: vscode.Range, value: string; }[] = [];
  comments: { range: vscode.Range, value: string; }[] = [];
  stringContaining(place: vscode.Position | vscode.Range) {
    for (const token of this.strings)
      if (token.range.contains(place)) return token;
    return null;
  }
  commentContaining(place: vscode.Position | vscode.Range) {
    for (const token of this.comments)
      if (token.range.contains(place)) return token;
    return null;
  }
}

function makeSectionSymbol(
  document: vscode.TextDocument,
  match: RegExpMatchArray,
  range: vscode.Range,
  gdasset: GDAsset,
) {
  const [, header, tag, rest] = match;
  const attributes: { [field: string]: string | undefined; } = {};
  let id: string | undefined;
  for (const assignment of rest.matchAll(/\b([\w-]+)\b\s*=\s*(?:(\d+)|"([^"\\]*)")/g)) {
    let value = assignment[2] ?? GDAssetProvider.unescapeString(assignment[3]);
    attributes[assignment[1]] = value;
    if (assignment[1] == 'id') id = value;
  }
  let s = new vscode.DocumentSymbol(tag, rest, vscode.SymbolKind.Object, range, range);
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
    for (const m of partInsideQuotes.matchAll(/\\(["bfnrt\\]|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{6})|\\$|\\?([^])/gmu)) {
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
    let previousEnd: vscode.Position | undefined;
    let currentSection: vscode.DocumentSymbol | undefined;
    let currentProperty: vscode.DocumentSymbol | null = null;
    const symbols: vscode.DocumentSymbol[] = [];
    const n = document.lineCount;
    for (let i = 0, j = 0; i < n;) {
      const range = document.validateRange(new vscode.Range(i, j, i, Infinity));
      const text = document.getText(range);
      let match;
      if (j == 0 && (match = text.match(
        /^(\[\s*([\p{L}\w-]+(?:\s+[\p{L}\w-]+|\s+"[^"\\]*")*(?=\s*\])|[^\[\]\s]+)\s*(.*?)\s*\])\s*([;#].*)?$/u
      ))) {
        // Section Header
        if (currentSection && previousEnd)
          currentSection.range = new vscode.Range(currentSection.range.start, previousEnd);
        if (gdasset)
          currentSection = makeSectionSymbol(document, match, range, gdasset);
        else {
          const [, header, tag, rest] = match;
          currentSection = new vscode.DocumentSymbol(tag, rest, vscode.SymbolKind.Object, range, range);
        }
        symbols.push(currentSection);
        currentProperty = null;
        previousEnd = range.end;
        i++;
        continue;
      } else if (j == 0 && (match = text.match(
        /^\s*(((?:[\p{L}\w-]+[./])*[\p{L}\w-]+)(?:\s*\[([\w\\/.:!@$%+-]+)\])?)\s*=/u
      ))) {
        // Property Assignment
        const [, prop, key, index] = match;
        let s = currentSection?.children ?? symbols;
        if (index) {
          const p = `${key}[]`;
          let parentProp = s.find(value => value.name == p);
          if (!parentProp)
            s.push(parentProp = new vscode.DocumentSymbol(p, '', vscode.SymbolKind.Array, range, range));
          parentProp.range = new vscode.Range(parentProp.range.start, range.end);
          s = parentProp.children;
        }
        if (currentSection)
          currentSection.range = new vscode.Range(currentSection.range.start, range.end);
        currentProperty = new vscode.DocumentSymbol(prop, '', vscode.SymbolKind.Property, range, range);
        s.push(currentProperty);
        j = match[0].length;
        previousEnd = new vscode.Position(i, j);
        continue;
      } else if (match = text.match(/^(\s*)([;#].*)?$/)) {
        // No more non-ignored tokens until end of line; only Line Comment or Whitespace
        if (gdasset && match[2]) {
          j += match[1].length;
          gdasset.comments.push({ range: new vscode.Range(i, j, i, range.end.character), value: match[2] });
        }
        previousEnd = range.end;
        j = 0; i++;
        continue;
      }
      // Parse values within line
      if (text.startsWith('"')) {
        // String
        let str = "";
        let s = text.substring(1); j++;
        lines: while (true) {
          for (const [sub] of s.matchAll(/"|(?:\\(?:["bfnrt\\]|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{6}|$)|\\?[^"\r\n])+/gmu)) {
            j += sub.length;
            if (sub == '"') break lines;
            str += GDAssetProvider.unescapeString(sub);
          }
          str += "\n";
          j = 0; i++;
          if (i >= n) break;
          s = document.lineAt(i).text;
        }
        if (i >= n) break;
        if (gdasset)
          gdasset.strings.push({ range: new vscode.Range(range.start.line, range.start.character, i, j), value: str });
      } else if (match = text.match(/^\s+/)) {
        // Whitespace
        j += match[0].length;
      } else {
        // Any other token
        match = text.match(/^[^"\s]+/);
        j += match![0].length;
      }
      if (currentProperty) {
        // Still in value of previous property
        const start = currentProperty.range.start;
        const endChar = i > range.end.line ? j : range.end.character;
        currentProperty.range = new vscode.Range(start.line, start.character, i, endChar);
      }
      previousEnd = new vscode.Position(i, j);
    }
    if (currentSection && previousEnd)
      currentSection.range = new vscode.Range(currentSection.range.start, previousEnd);
    return symbols;
  }
  
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken
  ): Promise<vscode.Definition | null> {
    if (document.languageId == 'config-definition') return null;
    const gdasset = this.defs[document.uri.toString(true)];
    if (!gdasset || gdasset.commentContaining(position)) return null;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    const wordIsResPath = isResPath(word, wordRange, document);
    let match;
    if (wordIsResPath) {
      let resUri = await resPathToUri(word, document);
      if (resUri instanceof vscode.Uri) return new vscode.Location(resUri, new vscode.Position(0, 0));
    } else if (match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(?:(\d+)|"([^"\\]*)")\s*\)$/)) {
      const keyword = match[1] as 'ExtResource' | 'SubResource';
      const id = match[2] ?? GDAssetProvider.unescapeString(match[3]);
      const s = gdasset.ids[keyword][id];
      if (!s) return null;
      if (gdasset.stringContaining(position)) return null;
      if (keyword == 'ExtResource') {
        let d = document.getText(s.selectionRange).indexOf(' path="');
        d = d < 0 ? 0 : d + 7;
        return new vscode.Location(document.uri, s.range.start.translate(0, d));
      }
      return new vscode.Location(document.uri, s.range);
    }
    return null;
  }
  
  async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    if (document.languageId == 'config-definition') return null;
    const gdasset = this.defs[document.uri.toString(true)];
    if (!gdasset || gdasset.commentContaining(position)) return null;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    const wordIsResPath = isResPath(word, wordRange, document);
    if (!wordIsResPath && gdasset.stringContaining(position)) return null;
    let hover = [], resPath, match;
    if (word == 'ext_resource' || wordIsResPath) {
      const line = document.lineAt(position).text;
      match = /^\[\s*ext_resource\s+.*?\bid\s*=\s*(?:(\d+)\b|"([^"\\]*)")/.exec(line);
      let s;
      if (word == 'ext_resource') {
        if (!match) return null;
        s = gdasset.ids.ExtResource[match[1] ?? GDAssetProvider.unescapeString(match[2])];
        resPath = s?.name ?? '';
      } else {
        resPath = word;
        let extIds = gdasset.ids.ExtResource;
        for (const id in extIds) {
          if (extIds[id]?.name != word) continue;
          s = extIds[id];
          break;
        }
      }
      hover.push(loadMarkdown(resPath, '', s?.detail ?? null));
    } else if (word == 'sub_resource') {
      const line = document.lineAt(position).text;
      match = /^\[\s*sub_resource\s+type\s*=\s*"([^"\\]*)"\s*id\s*=\s*(?:(\d+)\b|"([^"\\]*)")/.exec(line);
      if (!match) return null;
      const [, type, idN, idS] = match, id = idN ?? GDAssetProvider.unescapeString(idS);
      resPath = await resPathOfDocument(document);
      return new vscode.Hover(loadMarkdown(resPath, id, type), wordRange);
    } else if (word == 'gd_resource') {
      const line = document.lineAt(position).text;
      match = /^\[\s*gd_resource\s+type\s*=\s*"([^"\\]*)"/.exec(line);
      if (!match) return null;
      return new vscode.Hover(loadMarkdown(await resPathOfDocument(document), '', match[1]), wordRange);
    } else if (word == 'gd_scene') {
      const line = document.lineAt(position).text;
      match = /^\[\s*gd_scene\b/.exec(line);
      if (!match) return null;
      return new vscode.Hover(loadMarkdown(await resPathOfDocument(document), '', 'PackedScene'), wordRange);
    } else if (match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(?:(\d+)|"([^"\\]*)")\s*\)$/)) {
      const keyword = match[1] as 'ExtResource' | 'SubResource';
      const id = match[2] ?? GDAssetProvider.unescapeString(match[3]);
      const s = gdasset.ids[keyword][id];
      if (!s) return null;
      const md = new vscode.MarkdownString();
      if (keyword == 'SubResource') {
        resPath = await resPathOfDocument(document);
        md.appendCodeblock(`load("${resPath}::${id}") as ${s.detail}`, 'gdscript');
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
function loadMarkdown(resPath: string, id: string, type: string | null) {
  let code = id ? `load("${resPath}::${id}")` : `preload("${resPath}")`;
  if (type) code += ` as ${type}`;
  return new vscode.MarkdownString().appendCodeblock(code, 'gdscript');
}
async function projectDir(assetUri: vscode.Uri) {
  let uri = assetUri;
  do {
    const parent = vscode.Uri.joinPath(uri, '..'); // remove last path segment
    if (parent == uri) break; // don't try to go beyond root
    const projUri = vscode.Uri.joinPath(uri = parent, 'project.godot');
    try {
      await vscode.workspace.fs.stat(projUri);
      return parent; // folder containing project.godot
    } catch { } // project.godot was not found on that folder
  } while (uri.path);
  return null;
}
async function resPathOfDocument(document: vscode.TextDocument) {
  const assetUri = document.uri, assetPath = assetUri.path;
  const projDir = await projectDir(assetUri);
  if (projDir && assetPath.startsWith(projDir.path))
    return 'res:/' + assetPath.replace(projDir.path, ''); // remove proj path at the start to make it relative to proj
  return assetPath.replace(/^(?:.*\/)+/, ''); // fallback to document file name (relative path)
}
const uriRegex = /^[a-zA-Z][a-zA-Z0-9.+-]*:\/\/[^\x00-\x1F "<>\\^`{|}\x7F-\x9F]*$/;
/** Locates a resource by path string referenced in an asset document.
 * @param resPath Path of resource to locate. Can be relative to the document or to its project's root.
 * @param document Asset where path is. Its location and project are used as context to resolve the res path.
 * @returns Uri of the resource if it's found, or that URI as a string if file is not found.
 */
async function resPathToUri(resPath: string, document: vscode.TextDocument) {
  let resUri: vscode.Uri;
  if (resPath.startsWith('res://')) {
    const projDir = await projectDir(document.uri);
    if (!projDir) return resPath; // no project.godot found, res paths cannot be resolved
    resUri = vscode.Uri.joinPath(projDir, resPath.substring(6)); // 6 == 'res://'.length
  } else {
    if (uriRegex.test(resPath)) // does resPath have a scheme?
      return resPath; // better not to load arbitrary URI schemes like http, etc
    resUri = vscode.Uri.joinPath(document.uri, '..', resPath); // path is relative to folder of document
  }
  try { await vscode.workspace.fs.stat(resUri); } catch {
    return resUri.toString();
  }
  return resUri;
}
// Perfect pangrams for testing all ASCII letters; also letters which might be confused with numbers.
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
  if (/\.(svg|png|gif|jpe?g|bmp)$/i.test(resPath))
    return md.appendMarkdown(`[<img height=128 src="${resUri}"/>](${resUri})`);
  let match = /\.(ttf|otf|woff)$/i.exec(resPath);
  if (match) {
    const resStat = await vscode.workspace.fs.stat(resUri);
    // separate file is necessary because MarkdownString has a limit on the text size for performance reasons
    // use hash of path with modified time to index cached font preview image inside tmp folder
    const imgSrc = vscode.Uri.joinPath(tmpUri, `font-preview-${hash(resPath)}-${resStat.mtime}.svg`);
    try { // try to stat at that cache path
      await vscode.workspace.fs.stat(imgSrc); // if it succeeds, preview is already cached in tmp folder
    } catch { // otherwise, it must be created and written to tmp cache
      const type = match[1].toLowerCase();
      const bytes = await vscode.workspace.fs.readFile(resUri);
      // font must be inlined in data URI, since svg inside markdown won't be allowed to fetch it by URL
      const dataUrl = `data:font/${type};base64,${Buffer.from(bytes).toString('base64')}`;
      const imgData = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80"><style>
svg{background:white;margin:4px}
@font-face{font-family:_;src:url("${dataUrl}")}
text{font-family:_;dominant-baseline:text-before-edge}
</style><text>
${fontTest}
</text></svg>`;
      await vscode.workspace.fs.writeFile(imgSrc, Buffer.from(imgData));
    } // preview is at cached path; tmp will be cleaned on deactivate or, if not possible, on next activate
    md.appendMarkdown(`[<img src="${imgSrc}"/>](${resUri})`);
    return md;
  }
  return md.appendMarkdown(`[Open file](${resUri})`);
}

let tmpUri: vscode.Uri;
export async function activate(ctx: vscode.ExtensionContext) {
  tmpUri = vscode.Uri.joinPath(ctx.storageUri ?? ctx.globalStorageUri, 'tmp');
  try { // clean up any existing tmp files, or create tmp folder
    for (const [filename] of await vscode.workspace.fs.readDirectory(tmpUri))
      vscode.workspace.fs.delete(vscode.Uri.joinPath(tmpUri, filename), { recursive: true, useTrash: false });
  } catch { await vscode.workspace.fs.createDirectory(tmpUri); }
  let provider = new GDAssetProvider(), docs = GDAssetProvider.docs;
  ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(docs, provider));
  ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(docs, provider));
  ctx.subscriptions.push(vscode.languages.registerHoverProvider(docs, provider));
}
export function deactivate() {
  // try to delete tmp folder, sync if possible
  if (tmpUri.scheme == 'file') rmSync(tmpUri.fsPath, { force: true, recursive: true });
  else vscode.workspace.fs.delete(tmpUri, { recursive: true, useTrash: false }).then(undefined, () => { });
}

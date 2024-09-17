// GDAsset Features
import {
  workspace, Uri, CancellationToken, TextDocument, Range, Position, Color, TextEdit, MarkdownString,
  DocumentSymbol, SymbolKind, Definition, Location, Hover, ColorInformation, ColorPresentation, InlayHint,
  DocumentFilter, DocumentSymbolProvider, DefinitionProvider, HoverProvider, DocumentColorProvider, InlayHintsProvider,
} from 'vscode';
import GDAsset, { GDResource } from './GDAsset';
import { supported } from '../ExtensionEntry';
import { resPathOfDocument, locateResPath } from '../GodotProject';
import { apiDocs } from '../GodotDocs';
import { resPathPreview } from '../GodotAssetPreview';

function sectionSymbol(
  document: TextDocument, tag: string, rest: string, range: Range, gdasset: GDAsset
) {
  const attributes: { [field: string]: string | undefined; } = {};
  let id: string | undefined;
  for (const assignment of rest.matchAll(/\b([\w-]+)\b\s*=\s*(?:(\d+)|"([^"\\]*)"|((?:Ext|Sub)Resource\s*\(.*?\)))/g)) {
    const value = assignment[2] ?? assignment[4] ?? GDAssetProvider.unescapeString(assignment[3]!);
    attributes[assignment[1]!] = value;
    if (assignment[1] == 'id') id = value;
  }
  const symbol = new DocumentSymbol(tag, rest, SymbolKind.Namespace, range, range);
  switch (tag) {
    case 'gd_scene': {
      const docUriPath = document.uri.path;
      const [, fileTitle, ext] = /^\/(?:.*\/)*(.*?)(\.\w*)?$/.exec(docUriPath) ?? [undefined, docUriPath];
      symbol.name = fileTitle;
      symbol.detail = 'PackedScene';
      symbol.kind = SymbolKind.File;
      gdasset.resource = { path: `${fileTitle}${ext ?? ''}`, type: 'PackedScene', symbol };
      break;
    }
    case 'gd_resource': {
      const fileName = document.uri.path.replace(/^\/(.*\/)*/, ''); // with ext
      symbol.name = fileName;
      const type = attributes.type ?? '';
      symbol.detail = type;
      symbol.kind = SymbolKind.File;
      gdasset.resource = { path: fileName, type, symbol };
      break;
    }
    case 'ext_resource': {
      const type = attributes.type ?? '';
      if (id) gdasset.refs.ExtResource[id] = { path: attributes.path ?? '?', type, symbol };
      symbol.name = attributes.path ?? tag;
      symbol.detail = type;
      symbol.kind = SymbolKind.Variable;
      break;
    }
    case 'sub_resource': {
      const type = attributes.type ?? '';
      if (id) {
        const subPath = '::' + id;
        gdasset.refs.SubResource[id] = { path: `${gdasset.resource?.path ?? ''}${subPath}`, type, symbol };
        symbol.name = subPath;
      }
      symbol.detail = type;
      symbol.kind = SymbolKind.Object;
      break;
    }
    case 'node':
      if (attributes.parent == undefined)
        symbol.name = attributes.name ? GDAsset.nodeCode(`/root/${gdasset.rootNode = attributes.name}`) : tag;
      else symbol.name = gdasset.nodePath(`${attributes.parent}/${attributes.name}`);
      if (attributes.type) symbol.detail = attributes.type;
      else if (attributes.instance_placeholder) {
        const path = attributes.instance_placeholder;
        symbol.detail = `InstancePlaceholder # ${GDAsset.filename(path)?.title ?? path}`;
      } else if (attributes.instance) {
        const path = gdasset.resCall(attributes.instance)?.resource?.path ?? '?';
        symbol.detail = `# ${GDAsset.filename(path)?.title ?? path}`;
      } else if (attributes.index)
        symbol.detail = '@' + attributes.index;
      else symbol.detail = 'Node';
      symbol.kind = SymbolKind.Object;
      break;
    case 'connection':
      if (attributes.signal && attributes.from && attributes.to && attributes.method) {
        symbol.name = `${gdasset.nodePath(attributes.from)}.${attributes.signal}` +
          `.connect(${gdasset.nodePath(attributes.to)}.${attributes.method})`;
        symbol.detail = '';
      }
      symbol.kind = SymbolKind.Event;
      break;
    case 'editable':
      symbol.name = `is_editable_instance(${gdasset.nodePath(attributes.path ?? '')})`;
      symbol.detail = '';
      symbol.kind = SymbolKind.Boolean;
      break;
  }
  return symbol;
}

export default class GDAssetProvider implements
  DocumentSymbolProvider,
  DefinitionProvider,
  HoverProvider,
  InlayHintsProvider,
  DocumentColorProvider
{
  static godotDocs: DocumentFilter[] = [
    { language: 'godot-project' },
    { language: 'godot-resource' },
    { language: 'godot-scene' },
    { language: 'godot-asset' },
  ];
  static docs = GDAssetProvider.godotDocs.concat(
    { language: 'config-definition' },
  );
  
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
  
  defs: { [uri: string]: GDAsset | undefined; } = {};
  
  async parsedGDAsset(document: TextDocument, _token: CancellationToken) {
    if (document.languageId == 'config-definition') return undefined;
    let gdasset = this.defs[document.uri.toString(true)];
    if (!gdasset) {
      await this.provideDocumentSymbols(document, _token);
      gdasset = this.defs[document.uri.toString(true)];
    }
    return gdasset;
  }
  
  async provideDocumentSymbols(document: TextDocument, _token: CancellationToken): Promise<DocumentSymbol[]> {
    const gdasset = document.languageId == 'config-definition' ? null :
      this.defs[document.uri.toString(true)] = new GDAsset();
    let previousEnd: Position | undefined;
    let currentSection: DocumentSymbol | undefined;
    let currentProperty: DocumentSymbol | null = null;
    const symbols: DocumentSymbol[] = [];
    const n = document.lineCount;
    for (let i = 0, j = 0; i < n;) {
      const range = document.validateRange(new Range(i, j, i, Infinity));
      const text = document.getText(range);
      let match;
      if (j == 0 && (match = text.match(
        /^\s*(\[\s*([\p{L}\w-]+(?:\s+[\p{L}\w-]+|\s+"[^"\\]*")*(?=\s*\])|[^[\]\s]+)\s*([^;#]*?)\s*([\]{[(=]))\s*([;#].*)?$/u
      ))) {
        // Section Header
        if (currentSection && previousEnd)
          currentSection.range = new Range(currentSection.range.start, previousEnd);
        if (gdasset)
          currentSection = sectionSymbol(document, match[2]!, match[3]!, range, gdasset);
        else {
          const /* group1: header, */ tag = match[2]!, rest = match[3]!;
          const kind = rest ? SymbolKind.Object : SymbolKind.Namespace;
          currentSection = new DocumentSymbol(tag, rest, kind, range, range);
        }
        symbols.push(currentSection);
        currentProperty = null;
        previousEnd = range.end;
        i++; //NOTE ignores comment after header and strings inside rest; ideally should parse properly with ANTLR
        continue;
      } else if (j == 0 && (match = text.match(
        /^\s*(((?:[\p{L}\w-]+[./])*[\p{L}\w-]+)(?:\s*\[([\w\\/.:!@$%+-]+)\])?)\s*=/u
      ))) {
        // Property Assignment
        const prop = match[1]!, key = match[2]!, index = match[3];
        let s = currentSection?.children ?? symbols;
        if (index) {
          const p = `${key}[]`;
          let parentProp = s.find(value => value.name == p);
          if (!parentProp)
            s.push(parentProp = new DocumentSymbol(p, '', SymbolKind.Array, range, range));
          parentProp.range = new Range(parentProp.range.start, range.end);
          s = parentProp.children;
        }
        if (currentSection)
          currentSection.range = new Range(currentSection.range.start, range.end);
        currentProperty = new DocumentSymbol(prop, '', SymbolKind.Property, range, range);
        s.push(currentProperty);
        j = match[0].length;
        previousEnd = new Position(i, j);
        continue;
      } else if ((match = text.match(/^(\s*)([;#].*)?$/))) {
        // No more non-ignored tokens until end of line; only Line Comment or Whitespace
        if (gdasset && match[2]) {
          j += match[1]!.length;
          gdasset.comments.push({ range: new Range(i, j, i, range.end.character), value: match[2] });
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
          gdasset.strings.push({ range: new Range(range.start.line, range.start.character, i, j), value: str });
      } else if ((match = text.match(/^\s+/))) {
        // Whitespace
        j += match[0].length;
      } else if ((match = text.match(/^[^"\s]+/))) {
        // Any other token
        j += match[0].length;
      } else throw Error(); // should never happen
      if (currentProperty) {
        // Still in value of previous property
        const start = currentProperty.range.start;
        const endChar = i > range.end.line ? j : range.end.character;
        currentProperty.range = new Range(start.line, start.character, i, endChar);
      }
      previousEnd = new Position(i, j);
    }
    if (currentSection && previousEnd)
      currentSection.range = new Range(currentSection.range.start, previousEnd);
    return symbols;
  }
  
  //TODO sub-resPath goes to specific position in document
  async provideDefinition(document: TextDocument, position: Position, token: CancellationToken
  ): Promise<Definition | null> {
    const gdasset = this.defs[document.uri.toString(true)];
    if (!gdasset || gdasset.isInComment(position)) return null;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    let match;
    if (isPathWord(word, wordRange, document)) {
      const resLoc = await locateResPath(word, document.uri);
      if (typeof resLoc != 'string')
        return new Location(resLoc.uri, new Position(0, 0));
      return null;
    }
    if (gdasset.isInString(wordRange)) return null;
    if ((match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(?:(\d+)|"([^"\\]*)")\s*\)$/))) {
      const keyword = match[1] as 'ExtResource' | 'SubResource';
      const id = match[2] ?? GDAssetProvider.unescapeString(match[3]!);
      const s = gdasset.refs[keyword][id]?.symbol;
      if (!s) return null;
      if (keyword == 'ExtResource') {
        let d = document.getText(s.selectionRange).indexOf(' path="');
        d = d < 0 ? 0 : d + 7;
        return new Location(document.uri, s.range.start.translate(0, d));
      }
      return new Location(document.uri, s.range);
    }
    const outWord = document.getText(new Range(
      wordRange.start.line, 0, wordRange.end.line, wordRange.end.character + 1));
    if (outWord.match(/\btype="[^"\\]*"$|[([\]]$/) && (match = word.match(/^(?:@?[A-Z][A-Za-z0-9]+|float|int|bool)$/)))
      return await apiDocs(document, match[0], '', token);
    const line = document.lineAt(wordRange.start);
    if ((match = line.text.match(/^\s*(\w+)\s*=/)) && match[1] == word) {
      // when on a property, find out its class and navigate to it in the docs of its class
      const regexSectionClass =
        /^\s*\[\s*\w+(?:\s+\w+\s*=\s*(?:\d+|"[^"\\]*"))*?\s+type\s*=\s*"([^"\\]+)".*?\s*\]\s*(?:[;#].*)?$/;
      const regexSectionNoClass = /^\s*\[\s*(\w+)(?:\s+\w+\s*=\s*(?:\d+|"[^"\\]*"))*?.*?\s*\]\s*(?:[;#].*)?$/;
      for (let i = line.lineNumber - 1; i >= 0; i--) {
        const textLine = document.lineAt(i).text;
        if ((match = textLine.match(regexSectionClass)))
          return await apiDocs(document, match[1]!, word, token);
        if (!(match = textLine.match(regexSectionNoClass))) continue;
        let className;
        const sectionTag = match[1];
        if (sectionTag == 'resource' && gdasset.resource?.type) className = gdasset.resource.type;
        else if (sectionTag == 'node') className = 'Node';
        else if (sectionTag == 'sub_resource') className = 'Resource';
        else return null;
        return await apiDocs(document, className, word, token);
      }
      return null;
    }
    return null;
  }
  
  async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | null> {
    const gdasset = this.defs[document.uri.toString(true)];
    if (!gdasset || gdasset.isInComment(position)) return null;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    const wordIsPath = isPathWord(word, wordRange, document);
    if (!wordIsPath && gdasset.isInString(wordRange)) return null; // ignore strings (except resPaths)
    const hover: MarkdownString[] = [];
    let resPath, resRef;
    if (word == 'ext_resource' || wordIsPath) {
      let res: GDResource | undefined;
      if (word == 'ext_resource') {
        const line = document.lineAt(position).text;
        const match = /^\[\s*ext_resource\s+.*?\bid\s*=\s*(?:(\d+)\b|"([^"\\]*)")/.exec(line);
        if (!match) return null;
        res = gdasset.refs.ExtResource[match[1] ?? GDAssetProvider.unescapeString(match[2]!)];
        resPath = res?.path ?? '';
        if (!resPath) return null;
      } else {
        resPath = word;
        const extResSymbols = gdasset.refs.ExtResource;
        for (const id in extResSymbols) {
          if (extResSymbols[id]?.path == resPath) { res = extResSymbols[id]; break; }
        }
      }
      let id = null;
      const match = /^(.*?)::([^\\/:]*)$/.exec(resPath);
      if (match) {
        [resPath, id] = [match[1]!, match[2]!];
        if (!res && resPath == await resPathOfDocument(document)) {
          res = gdasset.refs.SubResource[id];
          return new Hover(gdCodeLoad(resPath, id, res?.type, document.languageId), wordRange);
        }
      } else if (!res && resPath == await resPathOfDocument(document))
        res = gdasset.resource;
      hover.push(gdCodeLoad(resPath, id, res?.type, document.languageId));
    } else if (word == 'sub_resource') {
      const line = document.lineAt(position).text;
      const match
        = /^\[\s*sub_resource\s+type\s*=\s*"([^"\\]*)"\s*id\s*=\s*(?:(\d+)\b|"([^"\\]*)")/.exec(line);
      if (!match) return null;
      const type = match[1]!, idN = match[2], idS = match[3];
      const id = idN ?? GDAssetProvider.unescapeString(idS!);
      resPath = await resPathOfDocument(document);
      return new Hover(gdCodeLoad(resPath, id, type, document.languageId), wordRange);
    } else if (word == 'gd_resource') {
      const line = document.lineAt(position).text;
      const match = /^\[\s*gd_resource\s+type\s*=\s*"([^"\\]*)"/.exec(line);
      if (!match) return null;
      resPath = await resPathOfDocument(document);
      hover.push(gdCodeLoad(resPath, null, match[1], document.languageId));
    } else if (word == 'gd_scene') {
      const line = document.lineAt(position).text;
      const match = /^\[\s*gd_scene\b/.exec(line);
      if (!match) return null;
      resPath = await resPathOfDocument(document);
      hover.push(gdCodeLoad(resPath, null, 'PackedScene', document.languageId));
    } else if ((resRef = gdasset.resCall(word))) {
      const res = resRef.resource;
      if (!res) return null;
      if (resRef.keyword == 'SubResource') {
        resPath = await resPathOfDocument(document);
        return new Hover(gdCodeLoad(resPath, resRef.id, res.type, document.languageId), wordRange);
      }
      resPath = res.path;
      hover.push(gdCodeLoad(resPath, null, res.type, document.languageId));
    } else return null;
    if (token.isCancellationRequested) return null;
    if (workspace.getConfiguration('godotFiles', document).get<boolean>('hover.previewResource')!) {
      // show link to res:// path if available
      if (!/^(?:user|uid):\/\//.test(resPath)) { // Locating user:// or uid:// paths is not supported yet
        const mdPreview = await resPathPreview(resPath, document, token);
        if (token.isCancellationRequested) return null;
        if (mdPreview) hover.push(mdPreview);
      }
    }
    return new Hover(hover, wordRange);
  }
  
  async provideInlayHints(document: TextDocument, range: Range, token: CancellationToken): Promise<InlayHint[] | null> {
    const settings = workspace.getConfiguration('godotFiles', document);
    const clarifyVectors = settings.get<boolean>('clarifyArrays.vector')!;
    const clarifyColors = settings.get<boolean>('clarifyArrays.color')!;
    if (!supported || !clarifyVectors && !clarifyColors) return null;
    const gdasset = await this.parsedGDAsset(document, token);
    if (!gdasset || token.isCancellationRequested) return null;
    const hints: InlayHint[] = [];
    // locate all packed vector arrays using regex, skipping occurrences inside a comment or string
    const reqStart = document.offsetAt(range.start);
    const reqSrc = document.getText(range);
    for (const m of reqSrc.matchAll(/\b(P(?:acked|ool)(?:Vector([234])|Color)Array)(\s*\(\s*)([\s,\w.+-]*?)\s*\)/g)) {
      const dim = m[2];
      if (dim && !clarifyVectors || !dim && !clarifyColors) continue;
      const ctorStart = reqStart + m.index;
      const ctorRange = new Range(document.positionAt(ctorStart), document.positionAt(ctorStart + m[0].length));
      if (gdasset.isNonCode(ctorRange)) continue;
      const type = m[1]!, paren = m[3]!, allArgs = m[4]!;
      const typeEnd = ctorStart + type.length;
      const argsStart = typeEnd + paren.length;
      // let i = 0;
      const regex = dim == '2' ? regex2Floats : dim == '3' ? regex3Floats : regex4Floats;
      for (const c of allArgs.matchAll(regex)) {
        const args = c[0];
        const itemPos = argsStart + c.index!;
        const itemRange = new Range(document.positionAt(itemPos), document.positionAt(itemPos + args.length));
        const head = new InlayHint(itemRange.start, '(');
        // head.tooltip = `[${i++}]`; // would need to provide 0-based indices for all types of array
        const tail = new InlayHint(itemRange.end, ')');
        // tail.tooltip = `vector #${i}`; // would need to provide 1-based indices for all types of array
        hints.push(head, tail);
      }
      //TODO would need to provide size for all arrays and dictionary
      // const arrayHead = new InlayHint(document.positionAt(typeEnd), `[${i}]`);
      // arrayHead.tooltip = i == 0 ? 'empty' : `${i} vector${i == 1 ? '' : 's'}`;
      // hints.push(arrayHead);
    }
    return hints;
  }
  
  async provideDocumentColors(document: TextDocument, token: CancellationToken): Promise<ColorInformation[] | null> {
    const settings = workspace.getConfiguration('godotFiles', document);
    const inlineColorSingles = settings.get<boolean>('inlineColors.single')!;
    const inlineColorArrays = settings.get<boolean>('inlineColors.array')!;
    if (!inlineColorSingles && !inlineColorArrays) return null;
    const gdasset = await this.parsedGDAsset(document, token);
    if (!gdasset || token.isCancellationRequested) return null;
    const colors: ColorInformation[] = [];
    // locate all color code using regex, skipping occurrences inside a comment or string
    for (const m of document.getText().matchAll(/\b((?:Color|P(?:acked|ool)ColorArray)\s*\(\s*)([\s,\w.+-]*?)\s*\)/g)) {
      const prefix = m[1]!, isSingle = prefix[0] == 'C';
      if (isSingle && !inlineColorSingles || !isSingle && !inlineColorArrays) continue;
      let start = m.index;
      const ctorRange = new Range(document.positionAt(start), document.positionAt(start + m[0].length));
      if (gdasset.isNonCode(ctorRange)) continue;
      if (isSingle) { // Color(...)
        const [red, green, blue, alpha] = m[2]!.split(/\s*,\s*/, 4).map(GDAsset.floatValue);
        colors.push(new ColorInformation(ctorRange, new Color(red ?? NaN, green ?? NaN, blue ?? NaN, alpha ?? NaN)));
        continue;
      }
      // PackedColorArray(...) | PoolColorArray(...)
      start += prefix.length;
      for (const c of m[2]!.matchAll(regex4Floats)) {
        const args = c[0];
        const itemPos = start + c.index;
        const itemRange = new Range(document.positionAt(itemPos), document.positionAt(itemPos + args.length));
        const [red, green, blue, alpha] = args.split(/\s*,\s*/, 4).map(GDAsset.floatValue);
        colors.push(new ColorInformation(itemRange, new Color(red ?? NaN, green ?? NaN, blue ?? NaN, alpha ?? 1)));
      }
    }
    return colors;
  }
  async provideColorPresentations(
    color: Color, context: { readonly document: TextDocument; readonly range: Range; }, _token: CancellationToken
  ): Promise<ColorPresentation[]> {
    const { document, range } = context;
    if (document.languageId == 'config-definition') return [];
    const { red, green, blue, alpha } = color;
    const r = GDAsset.float16Code(red ?? NaN);
    const g = GDAsset.float16Code(green ?? NaN);
    const b = GDAsset.float16Code(blue ?? NaN);
    const a = GDAsset.float16Code(alpha ?? 1);
    const args = `${r}, ${g}, ${b}, ${a}`;
    const label = ok(red) && ok(green) && ok(blue) && ok(alpha)
      ? `#${hex(red)}${hex(green)}${hex(blue)}${hex(alpha)}` : `Color(${args})`;
    const colorPresentation = new ColorPresentation(label);
    const code = /^Color\s*\([\s,\w.+-]*\)$/.test(document.getText(range)) ? `Color(${args})` : args;
    colorPresentation.textEdit = new TextEdit(range, code);
    return [colorPresentation];
    function ok(c: number) { return c >= 0 && c <= 1; }
    function hex(c: number) { return Math.round(c * 255).toString(16).toUpperCase().replace(/^.$/s, '0$&'); }
  }
}

const regex2Floats = /(?:[\w.+-]+\s*,\s*)?[\w.+-]+/g;
const regex3Floats = /(?:[\w.+-]+\s*,\s*){0,2}[\w.+-]+/g;
const regex4Floats = /(?:[\w.+-]+\s*,\s*){0,3}[\w.+-]+/g;

function isPathWord(word: string, wordRange: Range, document: TextDocument) {
  // check absolute path with scheme
  if (/^(?:res|user|uid|file):\/\/[^"\\]*$/.test(word)) return true;
  // get line text up to the word and check if word is the path of a ext_resource (for relative paths)
  const r = new Range(wordRange.start.line, 0, wordRange.end.line, wordRange.end.character + 1);
  const preWord = document.getText(r);
  return preWord[wordRange.start.character - 1] == '"' &&
    /^\s*\[\s*ext_resource\s+[^\n;#]*?\bpath\s*=\s*"(?:[^"\\]*)"$/.test(preWord);
}
function escCode(s: string) { return s.replace(/("|\\)/g, '\\$1'); }
function gdCodeLoad(resPath: string, id: string | null, type: string | undefined, language: string) {
  let code;
  if (type || id != null || /^(?:res|uid):\/\//.test(resPath)) {
    code = id != null ? `load("${resPath}::${id}")` : `preload("${resPath}")`;
    if (type) code += ` as ${type}`;
  } else { // typeless user:// and file:// schemes, and relative paths
    if (resPath.startsWith('file://')) resPath = Uri.parse(resPath).fsPath;
    code = `FileAccess.open("${escCode(resPath)}", FileAccess.READ)`;
  }
  return new MarkdownString().appendCodeblock(code, language);
}

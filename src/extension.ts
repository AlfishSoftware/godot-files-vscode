import {
  workspace, window, commands, languages, ExtensionContext, Uri, CancellationToken,
  TextDocument, Range, Position, FileSystemError, FileType, Color, TextEdit, MarkdownString,
  DocumentSymbol, SymbolKind, Definition, Location, Hover, ColorInformation, ColorPresentation, InlayHint,
  DocumentFilter, DocumentSymbolProvider, DefinitionProvider, HoverProvider, DocumentColorProvider, InlayHintsProvider,
} from 'vscode';
const nodejs = typeof process != 'undefined' ? process : undefined;
const createHash = nodejs && require('crypto').createHash;
const homedir = nodejs && require('os').homedir();

function md5(s: string) {
  return createHash?.('md5').update(s).digest('hex');
}
function sha512(s: string) {
  return createHash?.('sha512').update(s).digest('hex');
}
function jsHash(s: string, seed = 0) { // 53-bit hash, see https://stackoverflow.com/a/52171480
  let a = 0xDEADBEEF ^ seed, b = 0x41C6CE57 ^ seed;
  for (let i = 0, c; i < s.length; i++) {
    c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return 0x100000000 * (0x1FFFFF & b) + (a >>> 0);
}
/** Convert bytes to a base64 string, using either nodejs or web API. */
export function base64(data: Uint8Array) {
  if (nodejs) return Buffer.from(data).toString('base64');
  const url = new FileReaderSync().readAsDataURL(new Blob([data]));
  return url.substring(url.indexOf(',', 12) + 1); // `data:${mime};base64,${data}`
}
/** Encode text that goes after the comma in a `data:` URI. It tries to encode as few characters as possible.
 * To reduce excessive encoding, prefer using single quotes and collapsing newlines and tabs when possible.
*/
function encodeDataURIText(data: string) {
  return encodeURI(data).replace(/#|%20/g, s => s == '#' ? '%23' : ' ');
}
/** Text for a number of bytes using the appropriate base-1024 unit (byte(s), KiB, MiB, GiB, TiB). */
export function byteUnits(numBytes: number) {
  if (numBytes == 1) return '1 byte';
  if (numBytes < 1024) return numBytes + ' bytes';
  const k = numBytes / 1024;
  if (k < 1024) return k.toFixed(1) + ' KiB';
  const m = k / 1024;
  if (m < 1024) return m.toFixed(1) + ' MiB';
  const g = m / 1024;
  if (g < 1024) return g.toFixed(1) + ' GiB';
  const t = g / 1024;
  return t.toFixed(1) + ' TiB';
}

class GDResource {
  path!: string;
  type!: string;
  symbol!: DocumentSymbol;
}

class GDAsset {
  static floatValue(code: string): number | null {
    switch (code) { case 'nan': return NaN; case 'inf': return Infinity; case 'inf_neg': return -Infinity; }
    const n = +code;
    return isNaN(n) ? null : n;
  }
  static float16Code(value: number): string {
    if (isNaN(value)) return 'nan';
    if (value == Infinity) return 'inf';
    if (value == -Infinity) return 'inf_neg';
    return String(+value.toPrecision(6));
  }
  static filename(resPath: string) {
    const match = /^(?:.*[/\\])?([^/\\]*?)(\.[^./\\]*)?(::.*)?$/.exec(resPath);
    if (!match) return null;
    return { title: match[1], ext: match[2], subPath: match[3] };
  }
  static nodeCode(path: string, percent = false) {
    return (percent ? '%' : '$') + (/^\/?(?:[A-Za-z_]\w*\/)*[A-Za-z_]\w*$/.test(path) ? path : `"${path}"`);
  }
  rootNode: string | undefined = undefined;
  nodePath(n: string) {
    if (!this.rootNode || !n) return n;
    if (n == '.') return GDAsset.nodeCode('/root/' + this.rootNode);
    if (n.startsWith('./')) return GDAsset.nodeCode(n.substring(2));
    return GDAsset.nodeCode(n);
  }
  resCall(code: string) {
    const match = code.match(/^((?:Ext|Sub)Resource)\s*\(\s*(?:(\d+)|"([^"\\]*)")\s*\)$/);
    if (!match) return null;
    const keyword = match[1] as 'ExtResource' | 'SubResource';
    const id = match[2] ?? GDAssetProvider.unescapeString(match[3]);
    const resource = this.refs[keyword][id];
    return { keyword, id, resource };
  }
  resource: GDResource | undefined = undefined;
  refs = {
    ExtResource: {} as { [id: string]: GDResource | undefined },
    SubResource: {} as { [id: string]: GDResource | undefined },
  };
  strings: { range: Range, value: string; }[] = [];
  comments: { range: Range, value: string; }[] = [];
  isInString(place: Position | Range) {
    for (const token of this.strings)
      if (token.range.contains(place)) return true;
    return false;
  }
  isInComment(place: Position | Range) {
    for (const token of this.comments)
      if (token.range.contains(place)) return true;
    return false;
  }
  isNonCode(place: Position | Range) { return this.isInString(place) || this.isInComment(place); }
}

function sectionSymbol(document: TextDocument, match: RegExpMatchArray, range: Range, gdasset: GDAsset) {
  const [, /* header */, tag, rest] = match;
  const attributes: { [field: string]: string | undefined; } = {};
  let id: string | undefined;
  for (const assignment of rest.matchAll(/\b([\w-]+)\b\s*=\s*(?:(\d+)|"([^"\\]*)"|((?:Ext|Sub)Resource\s*\(.*?\)))/g)) {
    const value = assignment[2] ?? assignment[4] ?? GDAssetProvider.unescapeString(assignment[3]);
    attributes[assignment[1]] = value;
    if (assignment[1] == 'id') id = value;
  }
  const symbol = new DocumentSymbol(tag, rest, SymbolKind.Namespace, range, range);
  switch (tag) {
    case 'gd_scene': {
      const docUriPath = document.uri.path;
      const [, fileTitle, ext] = /^\/(?:.*\/)*(.*?)(\.[^.]*)?$/.exec(docUriPath) ?? [undefined, docUriPath];
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
      else if (attributes.index)
        symbol.detail = '@' + attributes.index;
      else if (attributes.instance_placeholder) {
        const path = attributes.instance_placeholder;
        symbol.detail = `InstancePlaceholder # ${GDAsset.filename(path)?.title ?? path}`;
      } else if (attributes.instance) {
        const path = gdasset.resCall(attributes.instance)?.resource?.path ?? '?';
        symbol.detail = `# ${GDAsset.filename(path)?.title ?? path}`;
      } else symbol.detail = '';
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

class GDAssetProvider implements
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
          currentSection = sectionSymbol(document, match, range, gdasset);
        else {
          const [, /* header */, tag, rest] = match;
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
        const [, prop, key, index] = match;
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
          j += match[1].length;
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
      const resLoc = await locateResPath(word, document);
      if (typeof resLoc != 'string')
        return new Location(resLoc.uri, new Position(0, 0));
    } else if ((match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(?:(\d+)|"([^"\\]*)")\s*\)$/))) {
      const keyword = match[1] as 'ExtResource' | 'SubResource';
      const id = match[2] ?? GDAssetProvider.unescapeString(match[3]);
      const s = gdasset.refs[keyword][id]?.symbol;
      if (!s) return null;
      if (gdasset.isInString(wordRange)) return null;
      if (keyword == 'ExtResource') {
        let d = document.getText(s.selectionRange).indexOf(' path="');
        d = d < 0 ? 0 : d + 7;
        return new Location(document.uri, s.range.start.translate(0, d));
      }
      return new Location(document.uri, s.range);
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
        res = gdasset.refs.ExtResource[match[1] ?? GDAssetProvider.unescapeString(match[2])];
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
        [resPath, id] = [match[1], match[2]];
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
      const [, type, idN, idS] = match, id = idN ?? GDAssetProvider.unescapeString(idS);
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
    for (const m of reqSrc.matchAll(/\b(P(?:acked|ool)(?:Vector([23])|Color)Array)(\s*\(\s*)([\s,\w.+-]*?)\s*\)/g)) {
      const dim = m[2];
      if (dim && !clarifyVectors || !dim && !clarifyColors) continue;
      const ctorStart = reqStart + m.index!;
      const ctorRange = new Range(document.positionAt(ctorStart), document.positionAt(ctorStart + m[0].length));
      if (gdasset.isNonCode(ctorRange)) continue;
      const [, type, , paren, allArgs] = m;
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
    if (!supported || !inlineColorSingles && !inlineColorArrays) return null;
    const gdasset = await this.parsedGDAsset(document, token);
    if (!gdasset || token.isCancellationRequested) return null;
    const colors: ColorInformation[] = [];
    // locate all color code using regex, skipping occurrences inside a comment or string
    for (const m of document.getText().matchAll(/\b((?:Color|P(?:acked|ool)ColorArray)\s*\(\s*)([\s,\w.+-]*?)\s*\)/g)) {
      const prefix = m[1], isSingle = prefix[0] == 'C';
      if (isSingle && !inlineColorSingles || !isSingle && !inlineColorArrays) continue;
      let start = m.index!;
      const ctorRange = new Range(document.positionAt(start), document.positionAt(start + m[0].length));
      if (gdasset.isNonCode(ctorRange)) continue;
      if (isSingle) { // Color(...)
        const [red, green, blue, alpha] = m[2].split(/\s*,\s*/, 4).map(GDAsset.floatValue);
        colors.push(new ColorInformation(ctorRange, new Color(red ?? NaN, green ?? NaN, blue ?? NaN, alpha ?? NaN)));
        continue;
      }
      // PackedColorArray(...) | PoolColorArray(...)
      start += prefix.length;
      for (const c of m[2].matchAll(regex4Floats)) {
        const args = c[0];
        const itemPos = start + c.index!;
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
/** Find the root folder Uri of the closest Godot project containing the asset.
 * @param assetUri Uri of the asset file for which to locate the project.
 * @returns Uri of the project's root folder if found, or null if the asset is not inside a project.
 */
export async function projectDir(assetUri: Uri) {
  let uri = assetUri;
  do {
    const parent = Uri.joinPath(uri, '..'); // remove last path segment
    if (parent == uri) break; // don't try to go beyond root
    const parentPath = parent.path;
    if (parentPath == '..' || parentPath.endsWith('/..')) break; // avoid infinite loop
    const projUri = Uri.joinPath(uri = parent, 'project.godot');
    try {
      await workspace.fs.stat(projUri);
      return parent; // folder containing project.godot
    } catch { /* project.godot was not found on that folder */ }
  } while (uri.path);
  return null;
}
async function resPathOfDocument(document: TextDocument) {
  const assetUri = document.uri;
  const assetPath = assetUri.path;
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
 * @throws Error if any error happens other than FileNotFound.
 */
async function locateResPath(resPath: string, document: TextDocument) {
  const assetUri = document.uri;
  let resUri: Uri;
  resPath = resPath.replace(/::[^:/\\]*$/, '');
  if (resPath.startsWith('res://')) {
    const projDir = await projectDir(assetUri);
    if (!projDir) return resPath; // no project.godot found, res paths cannot be resolved
    resUri = Uri.joinPath(projDir, resPath.substring(6)); // 6 == 'res://'.length
  } else if (resPath.startsWith('file://')) {
    resUri = Uri.parse(resPath, true); // absolute file URI
  } else if (/^\/|^[A-Z]:/.test(resPath)) {
    resUri = Uri.file(resPath); // absolute file path
  } else {
    if (uriRegex.test(resPath)) // does resPath have a scheme?
      return resPath; // better not to load arbitrary URI schemes like http, etc
    resUri = Uri.joinPath(assetUri, '..', resPath); // path is relative to folder of document
  }
  try {
    const resStat = await workspace.fs.stat(resUri);
    return { uri: resUri, stat: resStat };
  } catch (err) {
    if ((err as FileSystemError)?.code == 'FileNotFound')
      return resUri.toString();
    throw err;
  }
}
// Perfect pangrams for testing all ASCII letters; also letters which might be confused with numbers.
const fontTest = `\
<tspan>JFK GOT MY VHS, PC AND XLR WEB QUIZ</tspan>
<tspan x='0' y='20'>new job: fix mr. gluck's hazy tv pdq!</tspan>
<tspan x='0' y='40'>Oo0 Ili1 Zz2 3 A4 S5 G6 T7 B8 g9</tspan>`;
async function resPathPreview(resPath: string, document: TextDocument, token: CancellationToken
): Promise<MarkdownString | null> {
  const md = new MarkdownString();
  md.supportHtml = true;
  let resLoc;
  try {
    resLoc = await locateResPath(resPath, document);
    if (token.isCancellationRequested) return null;
  } catch (err) {
    const errName = (err as Error)?.name ?? 'Error';
    const errMsg = (err as Error)?.message ?? '';
    return md.appendMarkdown(`<div title="${errMsg}">${errName}!</div>`);
  }
  if (typeof resLoc == 'string')
    return md.appendMarkdown(`<div title="${resLoc}">Not found in local system</div>`);
  const { uri: resUri, stat: resStat } = resLoc;
  const resUriStr = resUri.toString();
  if (!(resStat.type & FileType.File)) // File bit is false
    return resStat.type & FileType.Directory // Check directory bit
      ? md.appendMarkdown(`<div title="${resUriStr}">Directory</div>`)
      : md.appendMarkdown(`<div title="${resUriStr}">Unkown</div>`);
  // res is a file and exists
  let match = /\.(svg|png|webp|jpe?g|bmp|gif)$/i.exec(resPath);
  if (match) {
    // link to image, and try to render it if possible
    const ext = match[1].toLowerCase();
    const type = ext == 'svg' ? 'svg+xml' : ext == 'jpg' ? 'jpeg' : ext;
    const encodedBytesSize = Math.ceil(resStat.size / 3) * 4;
    const imgDataUrlSize = 19 + type.length + encodedBytesSize;
    const mdSize = 28 + imgDataUrlSize + resUriStr.length;
    if (mdSize <= 100_000) {
      // image bytes fit in md text as data URI; prefer this, which works in browser and to avoid cache
      md.baseUri = resUri; // because we may be embedding an SVG with relative links
      const bytes = await workspace.fs.readFile(resUri);
      const imgData = base64(bytes);
      const imgSrc = `data:image/${type};base64,${imgData}`; // templateLength: 19+
      return md.appendMarkdown(`[<img height=128 src="${imgSrc}"/>](${resUriStr})`); // templateLength: 28+
    }
    if (mdScheme.has(resUri.scheme)) // load image if allowed
      return md.appendMarkdown(`[<img height=128 src="${resUriStr}"/>](${resUriStr})`);
    const thumbSrc = await resThumb(resUri, token); // try the small thumbnail image from Godot cache
    if (thumbSrc) return md.appendMarkdown(`[<img src="${thumbSrc}"/>](${resUriStr})`);
    else return md.appendMarkdown(`[Image file](${resUriStr})`); // otherwise, give up and just link to file
  }
  if (/\.(?:svgz|tga|dds|exr|hdr)$/i.test(resPath)) {
    // supported by Godot, but not by MarkdownString preview directly
    const thumbSrc = await resThumb(resUri, token); // try the small thumbnail image from Godot cache
    if (thumbSrc) return md.appendMarkdown(`[<img src="${thumbSrc}"/>](${resUriStr})`);
    return md.appendMarkdown(`[Image file](${resUriStr})`); // otherwise, give up and just link to file
  }
  match = /\.([to]tf|woff2?)$/i.exec(resPath);
  if (!match) {
    // unknown file type that we cannot render directly; but maybe Godot can preview it
    const thumbSrc = await resThumb(resUri, token); // try the small thumbnail image from Godot cache
    if (thumbSrc) return md.appendMarkdown(`[<img src="${thumbSrc}"/>](${resUriStr})`);
    return md.appendMarkdown(`[File](${resUriStr}) (${byteUnits(resStat.size)})`); // otherwise, give up and just link to file
  }
  // font file; we should embed it as base64 URI inside a font test SVG
  const type = match[1].toLowerCase();
  const fontDataUrlSize = 18 + type.length + Math.ceil(resStat.size / 3) * 4;
  const encodedImgSize = 275 + fontDataUrlSize + encodeDataURIText(fontTest).length;
  const imgDataUrlSize = 19 + encodedImgSize;
  const mdSize = 17 + imgDataUrlSize + resUriStr.length;
  if (mdSize <= 100_000) {
    const imgData = await svgFontTest(resUri, type);
    const imgSrc = `data:image/svg+xml,${encodeDataURIText(imgData)}`; // templateLength: 19+
    return md.appendMarkdown(`[<img src="${imgSrc}"/>](${resUriStr})`); // templateLength: 17+
  }
  // fontSize > ~74kB, md would be too big to render SVG as data URI; only option is to load SVG from a temp file
  const tmpUri = ctx.logUri;
  if (!mdScheme.has(tmpUri.scheme)) {
    // give up since tmp uri would not be allowed by markdownRenderer
    return md.appendMarkdown(`[Font file](${resUriStr})`);
  }
  // separate file is necessary because MarkdownString has a limit (100_000) on the text size for performance reasons
  // use hash of path with modified time to index cached font preview image inside tmp folder
  const imgSrc = Uri.joinPath(tmpUri, `font-preview-${jsHash(resUriStr)}-${resStat.mtime}.svg`);
  try { // try to stat at that cache path
    await workspace.fs.stat(imgSrc); // if it succeeds, preview is already cached in tmp folder
  } catch { // otherwise, it must be created and written to tmp cache
    if (token.isCancellationRequested) return null;
    try {
      const imgData = await svgFontTest(resUri, type);
      if (token.isCancellationRequested) return null;
      await workspace.fs.writeFile(imgSrc, new TextEncoder().encode(imgData)); // will auto create dirs
    } catch (err) { // some fs error? give up and just link
      console.error(err);
      return md.appendMarkdown(`[Font file](${resUriStr})`);
    }
  } // font preview SVG file is at cached path (logs folder); will be cleaned on deactivate if possible, or eventually
  return md.appendMarkdown(`[<img src="${imgSrc}"/>](${resUriStr})`);
}
/** Data URI for the PNG thumbnail of the resource from Godot cache; or null if not found or cancelled. */
async function resThumb(resUri: Uri, token: CancellationToken) {
  if (!process) return null;
  // Thumbnail max is 64x64 px = ~16KiB max, far less than the ~74kB MarkdownString base64 limit; ok to embed
  const resPathHash = md5(resUri.fsPath
    .replace(/^[a-z]:/, g0 => g0.toUpperCase()).replaceAll('\\', '/'));
  if (!resPathHash) return null; // in browser, would not be able to access Godot cache files anyway
  const platform = process.platform;
  const cachePaths = workspace.getConfiguration('godotFiles')
    .get<{ [platform: string]: string[]; }>('godotCachePath')![platform] ?? [];
  let lastThumbUri = null, lastModifiedTime = -Infinity;
  for (const cachePathString of cachePaths) {
    const cachePath = cachePathString.replace(/^~(?=\/)/, g0 => homedir ?? g0)
      .replace(platform == 'win32' ? /%(\w+)%/g : /\$\{(\w+)\}/g,
        (g0, g1) => process.env[g1] ?? g0);
    const thumbUri = Uri.joinPath(Uri.file(cachePath), `resthumb-${resPathHash}.png`);
    try {
      const stat = await workspace.fs.stat(thumbUri);
      if (token.isCancellationRequested) return null;
      const mtime = stat.mtime, size = stat.size;
      if (lastModifiedTime >= mtime || size <= 90 || size > 74000) continue;
      lastModifiedTime = mtime;
      lastThumbUri = thumbUri;
    } catch { continue; } // not found here, ignore
  }
  if (lastThumbUri == null) return null; // no cache img found
  try {
    const bytes = await workspace.fs.readFile(lastThumbUri);
    return 'data:image/png;base64,' + base64(bytes);
  } catch { return null; } // some fs error, ignore cache then
}
/** Create an SVG that can test a font using a pangram text. */
async function svgFontTest(fontUri: Uri, type: string) {
  const bytes = await workspace.fs.readFile(fontUri);
  // font must be inlined in data URI, since svg inside markdown won't be allowed to fetch it by URL
  const dataUrl = `data:font/${type};base64,${base64(bytes)}`; // templateLength: 18+ ; same when encoded
  return `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='80'><style>
svg{background:white;margin:4px}
@font-face{font-family:_;src:url('${dataUrl}')}
text{font-family:_;dominant-baseline:text-before-edge}
</style><text>
${fontTest}
</text></svg>`; // templateLength: 227+ ; encodedTemplateLength: 275+
}
/** URL schemes that markdownRenderer allows loading from */
const mdScheme = new Set(['data', 'file', 'https', 'vscode-file', 'vscode-remote', 'vscode-remote-resource', 'mailto']);

async function unlockEarlyAccess() {
  if (supported) {
    if (await window.showInformationMessage('Early access is already enabled.', 'OK', 'Disable') == 'Disable') {
      supported = false;
      ctx.globalState.update('supportKey', undefined);
    }
    return;
  }
  const password = await window.showInputBox({
    title: 'Password to unlock early access:',
    placeHolder: 'A password is received when making a donation.',
    password: true,
    prompt: 'Check the README page for more info.'
  });
  if (!password) return;
  const hash = sha512(password);
  if (hash != checksum) {
    window.showErrorMessage(
      'Incorrect password. Paste it exactly like you received when donating.');
    return;
  }
  supported = true;
  ctx.globalState.update('supportKey', hash);
  window.showInformationMessage(
    'Thank you for the support! ❤️\nEarly access is now unlocked, just for you. 😊');
}

const deleteRecursive = { recursive: true, useTrash: false };
/** Permanently delete a file or an entire folder. */
async function del(uri: Uri) {
  try { await workspace.fs.delete(uri, deleteRecursive); } catch { /* didn't exist */ }
}

let ctx: ExtensionContext;
let supported = false;
/** The extension entry point, which runs when the extension is enabled for the IDE window. */
export async function activate(context: ExtensionContext) {
  if (!workspace.isTrusted) {
    context.subscriptions.push(workspace.onDidGrantWorkspaceTrust(() => { activate(context); }));
    return;
  }
  ctx = context;
  // cleanup garbage from older versions; no need to await
  if (ctx.storageUri) del(ctx.storageUri);
  del(ctx.globalStorageUri);
  // check if supporting
  ctx.globalState.setKeysForSync([]);
  if (nodejs) {
    if (ctx.globalState.get('supportKey') == checksum) supported = true;
    ctx.subscriptions.push(commands.registerCommand('godotFiles.unlockEarlyAccess', unlockEarlyAccess));
  }
  // register all providers
  const provider = new GDAssetProvider();
  ctx.subscriptions.push(languages.registerDocumentSymbolProvider(GDAssetProvider.docs, provider));
  ctx.subscriptions.push(languages.registerDefinitionProvider(GDAssetProvider.godotDocs, provider));
  ctx.subscriptions.push(languages.registerHoverProvider(GDAssetProvider.godotDocs, provider));
  ctx.subscriptions.push(languages.registerInlayHintsProvider(GDAssetProvider.godotDocs, provider));
  ctx.subscriptions.push(languages.registerColorProvider(GDAssetProvider.godotDocs, provider));
}

/** Runs to cleanup resources when extension is disabled. May not run in browser, and is limited to 5s.
 * VSCode APIs can be unusable here; it may run after renderer process is gone (closing IDE window).
 * Context subscriptions are disposed after this.
 */
export function deactivate() {
  const tmpUri = ctx?.logUri;
  if (!tmpUri) return;
  // try to delete tmp folder
  if (tmpUri.scheme == 'file') try {
    nodejs && require('fs').rmSync(tmpUri.fsPath, { force: true, recursive: true });
  } catch { /* ignore, logs should be auto-deleted eventually anyway */ }
}

const checksum = '1ee835486c75add4e298d9120c62801254ecb9f69309f1f67af4d3495bdf7ba14e288b73298311f5ef7839ec34bfc12211a035911d3ad19a60e822a9f44d4d5c';

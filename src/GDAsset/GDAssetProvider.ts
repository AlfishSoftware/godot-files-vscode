// GDAsset Features
import {
  workspace, window, Uri, CancellationToken, TextDocument, Range, Position, Color, TextEdit, MarkdownString,
  DocumentSymbol, SymbolKind, Definition, Location, Hover, ColorInformation, ColorPresentation,
  DocumentFilter, DocumentSymbolProvider, DefinitionProvider, HoverProvider, DocumentColorProvider, InlayHintsProvider,
  ThemeColor, ThemableDecorationAttachmentRenderOptions, InlayHint, InlayHintKind, InlayHintLabelPart,
} from 'vscode';
import GDAsset, { GDResource } from './GDAsset';
import { resPathOfDocument, locateResPath, resolveUidInDocument } from '../GodotProject';
import { apiDocs } from '../GodotDocs';
import { resPathPreview } from '../GodotAssetPreview';
import GodotFiles, { openSponsorUrl } from '../ExtensionEntry';

let refusedUidResolveOffer = false;

function sectionSymbol(
  document: TextDocument, tag: string, rest: string, range: Range, gdasset: GDAsset
) {
  const attributes: { [field: string]: string | undefined; } = {};
  let id: string | undefined, typeRange: Range | undefined, uidRange: Range | undefined, pathRange: Range | undefined;
  for (const assignment of rest.matchAll(/\b([\w-]+)\b\s*=\s*(?:(\d+)|"([^"\\]*)"|((?:Ext|Sub)Resource\s*\(.*?\)))/g)) {
    const value = assignment[2] ?? assignment[4] ?? GDAsset.unescapeString(assignment[3]!);
    const attr = assignment[1]!;
    attributes[attr] = value;
    if (attr == 'id') id = value;
    else if (assignment[3] != null && /^(?:type|uid|path)$/.test(attr)) {
      const rangeText = document.getText(range);
      const matchStart = rangeText.indexOf(assignment[0], tag.length + 2);
      const valueStart = assignment[0].indexOf('"', attr.length + 1) + 1;
      const { start } = range, valueRange = new Range(
        start.translate(0, matchStart + valueStart),
        start.translate(0, matchStart + valueStart + assignment[3].length),
      );
      switch (attr) {
        case 'type': typeRange = valueRange; break;
        case 'uid': uidRange = valueRange; break;
        case 'path': pathRange = valueRange; break;
      }
    }
  }
  const symbol = new DocumentSymbol(tag, rest, SymbolKind.Namespace, range, range);
  switch (tag) {
    case 'gd_scene': {
      const docUriPath = document.uri.path;
      const [, fileTitle, ext] = /^\/(?:.*\/)*(.*?)(\.\w*)?$/.exec(docUriPath) ?? [undefined, docUriPath];
      const uid = attributes.uid ?? '';
      symbol.name = fileTitle;
      symbol.detail = 'PackedScene';
      symbol.kind = SymbolKind.File;
      gdasset.resource = { path: `${fileTitle}${ext ?? ''}`, uid, uidRange, type: 'PackedScene', symbol };
      break;
    }
    case 'gd_resource': {
      const fileName = document.uri.path.replace(/^\/(?:.*\/)*/, ''); // with ext
      symbol.name = fileName;
      const type = attributes.type ?? '', uid = attributes.uid ?? '';
      symbol.detail = type;
      symbol.kind = SymbolKind.File;
      gdasset.resource = { path: fileName, uid, uidRange, type, typeRange, symbol };
      break;
    }
    case 'ext_resource': {
      const type = attributes.type ?? '';
      if (id) {
        const uid = attributes.uid ?? '', path = attributes.path ?? '?';
        if (attributes.path) gdasset.addMinimalPath(path.split(/[/\\]/g));
        gdasset.refs.ExtResource[id] = { path, pathRange, uid, uidRange, type, typeRange, symbol };
      }
      symbol.name = attributes.path ?? tag;
      symbol.detail = type;
      symbol.kind = SymbolKind.Variable;
      break;
    }
    case 'sub_resource': {
      const type = attributes.type ?? '';
      if (id) {
        const subPath = '::' + id, path = `${gdasset.resource?.path ?? ''}${subPath}`;
        gdasset.refs.SubResource[id] = { path, id, type, typeRange, symbol };
        symbol.name = subPath;
      }
      symbol.detail = type;
      symbol.kind = SymbolKind.Object;
      break;
    }
    case 'node':
      if (attributes.parent == undefined)
        symbol.name = attributes.name ? GDAsset.nodeCode(`../${gdasset.rootNode = attributes.name}`) : tag;
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
          gdasset.comments.push({ innerRange: new Range(i, j + 1, i, range.end.character), value: match[2] });
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
            str += GDAsset.unescapeString(sub);
          }
          str += "\n";
          j = 0; i++;
          if (i >= n) break;
          s = document.lineAt(i).text;
        }
        if (i >= n) break;
        if (gdasset) gdasset.strings.push({
          innerRange: new Range(range.start.line, range.start.character + 1, i, j - 1), value: str
        });
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
    if (gdasset) {
      GDAssetProvider.updateDecorations(document, {
        vectorParentheses: this.decorateVectorParentheses(document, gdasset),
      });
    }
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
      if (!GodotFiles.supported && !refusedUidResolveOffer && word.startsWith('uid://')) {
        const m = `On early access, uid paths can be resolved into their res paths. \
This allows you to navigate to the source, see the implied path and quickly replace it into strings.`;
        const ok = 'See how to enable', no = 'No';
        window.showInformationMessage(m, ok, no).then(async (r) => {
          if (r == ok) await openSponsorUrl();
          else if (r == no) refusedUidResolveOffer = true;
        });
      }
      const resLoc = await locateResPath(word, document.uri);
      return typeof resLoc == 'string' ? null : new Location(resLoc.uri, new Position(0, 0));
    }
    if (gdasset.isInString(wordRange)) return null;
    if ((match = word.match(/^((?:Ext|Sub)Resource)\s*\(\s*(?:(\d+)|"([^"\\]*)")\s*\)$/))) {
      const keyword = match[1] as 'ExtResource' | 'SubResource';
      const id = match[2] ?? GDAsset.unescapeString(match[3]!);
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
    const documentUri = document.uri;
    const gdasset = this.defs[documentUri.toString(true)];
    if (!gdasset || gdasset.isInComment(position)) return null;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    const wordIsPath = isPathWord(word, wordRange, document);
    if (!wordIsPath && gdasset.isInString(wordRange)) return null; // ignore strings (except resPaths)
    const hover: MarkdownString[] = [];
    let resPath: string, resRef;
    if (word == 'ext_resource' || wordIsPath) {
      let res: GDResource | undefined;
      if (word == 'ext_resource') {
        const line = document.lineAt(position).text;
        const match = /^\[\s*ext_resource\s+.*?\bid\s*=\s*(?:(\d+)\b|"([^"\\]*)")/.exec(line);
        if (!match) return null;
        res = gdasset.refs.ExtResource[match[1] ?? GDAsset.unescapeString(match[2]!)];
        resPath = res?.path ?? '';
        if (!resPath) return null;
      } else {
        resPath = word.startsWith('uid:') ? await resolveUid(word, gdasset, documentUri) ?? word : word;
        const extResSymbols = gdasset.refs.ExtResource;
        for (const id in extResSymbols) {
          if (extResSymbols[id]?.path == resPath) { res = extResSymbols[id]; break; }
        }
      }
      let id: string | null = null;
      const match = /^(.*?)::([^\\/:]*)$/.exec(resPath);
      if (match) {
        [resPath, id] = [match[1]!, match[2]!];
        if (!res && resPath.startsWith('res:') && resPath == await resPathOfDocument(documentUri)) {
          res = gdasset.refs.SubResource[id];
          return new Hover(gdCodeLoad(resPath, id, res?.type, document.languageId), wordRange);
        }
      } else if (!res && resPath.startsWith('res:') && resPath == await resPathOfDocument(documentUri))
        res = gdasset.resource;
      hover.push(gdCodeLoad(resPath, id, res?.type, document.languageId));
    } else if (word == 'sub_resource') {
      const line = document.lineAt(position).text;
      const match
        = /^\[\s*sub_resource\s+type\s*=\s*"([^"\\]*)"\s*id\s*=\s*(?:(\d+)\b|"([^"\\]*)")/.exec(line);
      if (!match) return null;
      const type = match[1]!, idN = match[2], idS = match[3];
      const id = idN ?? GDAsset.unescapeString(idS!);
      resPath = await resPathOfDocument(documentUri);
      return new Hover(gdCodeLoad(resPath, id, type, document.languageId), wordRange);
    } else if (word == 'gd_resource') {
      const line = document.lineAt(position).text;
      const match = /^\[\s*gd_resource\s+type\s*=\s*"([^"\\]*)"/.exec(line);
      if (!match) return null;
      resPath = await resPathOfDocument(documentUri);
      hover.push(gdCodeLoad(resPath, null, match[1], document.languageId));
    } else if (word == 'gd_scene') {
      const line = document.lineAt(position).text;
      const match = /^\[\s*gd_scene\b/.exec(line);
      if (!match) return null;
      resPath = await resPathOfDocument(documentUri);
      hover.push(gdCodeLoad(resPath, null, 'PackedScene', document.languageId));
    } else if ((resRef = gdasset.resCall(word))) {
      const res = resRef.resource;
      if (!res) return null;
      if (resRef.keyword == 'SubResource') {
        resPath = await resPathOfDocument(documentUri);
        return new Hover(gdCodeLoad(resPath, resRef.id, res.type, document.languageId), wordRange);
      }
      resPath = res.path;
      hover.push(gdCodeLoad(resPath, null, res.type, document.languageId));
    } else return null;
    if (token.isCancellationRequested) return null;
    if (workspace.getConfiguration('godotFiles', document).get<boolean>('hover.previewResource')!) {
      // show link to res:// path if available
      if (!resPath.startsWith('user://')) { // Cannot locate user:// paths
        const mdPreview = await resPathPreview(resPath, document, token);
        if (token.isCancellationRequested) return null;
        if (mdPreview) hover.push(mdPreview);
      }
    }
    return new Hover(hover, wordRange);
  }
  
  async provideInlayHints(document: TextDocument, range: Range, token: CancellationToken
  ): Promise<InlayHint[] | null> {
    const settings = workspace.getConfiguration('godotFiles.clarifyReferences', document);
    const sClass = settings.get<string>('class') ?? 'auto';
    const sAsOperator = settings.get<string>('asOperator') ?? '#';
    const sFilePaths = settings.get<string>('filePath')!;
    if (sClass == 'never' && sFilePaths == 'none') return null;
    const gdasset = await this.parsedGDAsset(document, token);
    if (!gdasset || token.isCancellationRequested) return null;
    const hints: InlayHint[] = [];
    const reqStart = document.offsetAt(range.start);
    const reqSrc = document.getText(range);
    // locate all calls using regex, skipping occurrences inside a comment or string
    for (const m of reqSrc.matchAll(
      /\b(?<=(instance[ \t]*=)?[ \t]*)((?:Ext|Sub)Resource|NodePath)[ \t]*\(\s*(?:(\d+)|"([^"\r\n]*)")\s*\)(?=([ \t]*\])?[ \t]*([^;\r\n]?))/g
    )) {
      const matchStart = reqStart + m.index, matchEnd = matchStart + m[0].length;
      const matchRange = new Range(document.positionAt(matchStart), document.positionAt(matchEnd));
      if (gdasset.isNonCode(matchRange)) continue;
      const bracket = m[5], instancing = !!(m[1] && bracket);
      const fn = m[2] as 'ExtResource' | 'SubResource' | 'NodePath', eol = !m[6] && (!bracket || instancing);
      if (fn == 'NodePath') {
        continue; //TODO
      } else {
        const id = m[3] ?? GDAsset.unescapeString(m[4]!);
        const resource = gdasset.refs[fn][id];
        if (!resource) continue;
        const { type, typeRange } = resource, { end } = matchRange;
        if (sClass == 'always' ||
          sClass == 'auto' && !(instancing && type == 'PackedScene') && type != 'Resource' && !id.startsWith(type + '_')
        ) {
          const typePos = end;
          if (sAsOperator) hints.push(new InlayHint(typePos, sAsOperator));
          const typeLabel = new InlayHintLabelPart(type);
          if (typeRange) typeLabel.location = new Location(document.uri, typeRange);
          const typeHint = new InlayHint(typePos, [typeLabel], InlayHintKind.Type);
          hints.push(typeHint);
        }
        const pathRange = 'pathRange' in resource ? resource.pathRange : undefined;
        if (pathRange && eol && sFilePaths != 'none') {
          const pathPos = bracket ? end.translate(0, bracket.length) : end;
          const shownPath = getDisplayPath(resource.path, sFilePaths, gdasset);
          const pathLabel = new InlayHintLabelPart(shownPath);
          pathLabel.location = new Location(document.uri, pathRange);
          const pathHint = new InlayHint(pathPos, [new InlayHintLabelPart('; '), pathLabel]);
          hints.push(pathHint);
        }
      }
    }
    // locate all uid path strings, skipping occurrences inside a comment or within another string
    if (GodotFiles.supported && sFilePaths != 'none') for (const m of reqSrc.matchAll(
      /(?<=((?:^|\s+)uid\s*=\s*)?)("|^)(uid:\/*\w+)\2(?=([ \t;,:)\]}])|$)/mg
    )) {
      const eol = !m[4];
      if (m[1] && (!eol || document.fileName.toLowerCase().endsWith('.import'))) continue;
      const matchStart = reqStart + m.index, matchEnd = matchStart + m[0].length;
      const matchRange = new Range(document.positionAt(matchStart), document.positionAt(matchEnd));
      if (gdasset.isNonCode(matchRange)) continue;
      const quoted = m[2]!;
      const uidPath = quoted ? GDAsset.unescapeString(m[3]!) : m[3]!;
      const resPath = await resolveUid(uidPath, gdasset, document.uri);
      if (!resPath) continue;
      const shownPath = getDisplayPath(resPath, sFilePaths, gdasset);
      const pathLabel = new InlayHintLabelPart(shownPath);
      const innerRange = !quoted ? matchRange
        : new Range(matchRange.start.translate(0, 1), matchRange.end.translate(0, -1));
      pathLabel.location = new Location(document.uri, innerRange);
      const sepLabel = new InlayHintLabelPart(!quoted ? ' | ' : eol ? '; ' : ' ');
      const pathHint = new InlayHint(matchRange.end, [sepLabel, pathLabel]);
      if (/^godot-(?:scene|resource|project)$/.test(document.languageId))
        pathHint.textEdits = [TextEdit.replace(innerRange, resPath)];
      hints.push(pathHint);
    }
    return hints;
  }
  decorateVectorParentheses(document: TextDocument, gdasset: GDAsset): Range[] {
    const settings = workspace.getConfiguration('godotFiles.clarifyArrays', document);
    const clarifyVectors = settings.get<boolean>('vector')!;
    const clarifyColors = settings.get<boolean>('color')!;
    if (!clarifyVectors && !clarifyColors) return [];
    const maxChars = workspace.getConfiguration('editor', document).get<number>('maxTokenizationLineLength')!;
    const ranges: Range[] = [];
    const src = document.getText();
    // locate all packed vector arrays using regex, skipping occurrences inside a comment or string
    for (const m of src.matchAll(/\b(P(?:acked|ool)(?:Vector([234])|Color)Array)(\s*\(\s*)([\s,\w.+-]*?)\s*\)/g)) {
      const charLength = m[0].length;
      if (charLength >= maxChars) continue;
      const dim = m[2];
      if (dim && !clarifyVectors || !dim && !clarifyColors) continue;
      const ctorStart = m.index;
      const ctorRange = new Range(document.positionAt(ctorStart), document.positionAt(ctorStart + charLength));
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
        ranges.push(itemRange);
      }
    }
    return ranges;
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
  
  static updateDecorations(document: TextDocument, decorations: DecorationRanges): void {
    for (const editor of window.visibleTextEditors.filter(e => e.document == document)) {
      editor.setDecorations(parenthesesDecoration, decorations.vectorParentheses);
    }
  }
}

function getDisplayPath(srcPath: string, displayMode: string, gdasset: GDAsset): string {
  switch (displayMode) {
    case 'filename': return srcPath.replace(/^(?:[^/\\]*[/\\])+/, '');
    case 'exact': return srcPath;
    default: for (const [minimalPath, exactPath] of gdasset.pathsByMinimalForm) {
      if (srcPath != exactPath) continue;
      // replace shown path with its minimal form if using `minimal` setting
      if (srcPath != minimalPath) return '…/' + minimalPath;
      return srcPath;
    }
  }
  return srcPath;
}

interface DecorationRanges {
  vectorParentheses: Range[];
}
const themeColorInlayFg = new ThemeColor('editorInlayHint.foreground');
const themeColorInlayBg = new ThemeColor('editorInlayHint.background');
const themeInlay: ThemableDecorationAttachmentRenderOptions = {
  color: themeColorInlayFg, backgroundColor: themeColorInlayBg,
  fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none',
};
const parenthesesDecoration = window.createTextEditorDecorationType({
  before: { ...themeInlay, contentText: '(' }, after: { ...themeInlay, contentText: ')' },
});

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
  if (type || id != null || /^(?:res|uid):/.test(resPath)) {
    code = id != null ? `load("${escCode(resPath)}::${id}")` : `preload("${escCode(resPath)}")`;
    if (type) code += ` as ${type}`;
  } else if (/^file:/i.test(resPath)) { // typeless file: URI
    code = `FileAccess.open("${escCode(Uri.parse(resPath).fsPath)}", FileAccess.READ)`;
  } else if (/^user:/.test(resPath)) { // typeless user: scheme
    code = `FileAccess.open("${escCode(resPath)}", FileAccess.READ)`;
  } else code = `preload("${escCode(resPath)}")`; // typeless relative paths
  return new MarkdownString().appendCodeblock(code, language);
}

async function resolveUid(uidPath: string, gdasset: GDAsset, documentUri: Uri) {
  const resource = gdasset.resolveLocalUid(uidPath);
  if (resource && resource == gdasset.resource) return await resPathOfDocument(documentUri)
  return resource?.path ?? await resolveUidInDocument(uidPath, documentUri);
}

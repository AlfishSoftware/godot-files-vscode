// GDAsset Structure
import { Range, Position, DocumentSymbol } from 'vscode';
import GDAssetProvider from './GDAssetProvider';

export class GDResource {
  path!: string;
  type!: string;
  symbol!: DocumentSymbol;
}

export default class GDAsset {
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
    const match = /^(?:.*[/\\])?([^/\\]*?)(\.[^./\\<>]*)?(::.*)?$/.exec(resPath);
    if (!match) return null;
    return { title: match[1], ext: match[2], subPath: match[3] };
  }
  static nodeCode(path: string, percent = false) {
    return (percent ? '%' : '$') + (/^\/?(?:[A-Za-z_]\w*\/)*[A-Za-z_]\w*$/.test(path) ? path : `"${path}"`);
  }
  rootNode: string | undefined = undefined;
  nodePath(n: string) {
    if (!this.rootNode || !n) return n;
    if (n == '.') return GDAsset.nodeCode('../' + this.rootNode);
    if (n.startsWith('./')) return GDAsset.nodeCode(n.substring(2));
    return GDAsset.nodeCode(n);
  }
  resCall(code: string) {
    const match = code.match(/^((?:Ext|Sub)Resource)\s*\(\s*(?:(\d+)|"([^"\\]*)")\s*\)$/);
    if (!match) return null;
    const keyword = match[1] as 'ExtResource' | 'SubResource';
    const id = match[2] ?? GDAssetProvider.unescapeString(match[3]!);
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

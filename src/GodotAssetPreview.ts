// Godot Asset Previewing
import { workspace, Uri, CancellationToken, TextDocument, FileType, MarkdownString } from 'vscode';
import { base64 } from './+cross/Platform';
import { jsHash, encodeDataURIText, byteUnits } from './Helper';
import { ctx } from './ExtensionEntry';
import { locateResPath } from './GodotProject';
import * as pc_GodotInstallation from './@pc/GodotInstallation';
const resThumb = pc_GodotInstallation.resThumb ?? (async () => null);

const fromUTF8 = new TextEncoder();
// Perfect pangrams for testing all ASCII letters; also letters which might be confused with numbers.
const fontTest = `\
<tspan>JFK GOT MY VHS, PC AND XLR WEB QUIZ</tspan>
<tspan x='0' y='20'>new job: fix mr. gluck's hazy tv pdq!</tspan>
<tspan x='0' y='40'>Oo0 Ili1 Zz2 3 A4 S5 G6 T7 B8 g9</tspan>`;
export async function resPathPreview(resPath: string, document: TextDocument, token: CancellationToken
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
    // otherwise, give up and just link to file
    return md.appendMarkdown(`[File](${resUriStr}) (${byteUnits(resStat.size)})`);
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
      await workspace.fs.writeFile(imgSrc, fromUTF8.encode(imgData)); // will auto create dirs
    } catch (err) { // some fs error? give up and just link
      console.error(err);
      return md.appendMarkdown(`[Font file](${resUriStr})`);
    }
  } // font preview SVG file is at cached path (logs folder); will be cleaned on deactivate if possible, or eventually
  return md.appendMarkdown(`[<img src="${imgSrc}"/>](${resUriStr})`);
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

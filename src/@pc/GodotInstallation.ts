// Helper code for Godot installation, only on PC/NodeJS platform
import * as crypto from 'crypto';
import * as os from 'os';
import { workspace, Uri, CancellationToken } from 'vscode';
import { base64 } from '../+cross/Platform';

const homeDir = os.homedir();
function md5(s: string) {
  return crypto.createHash('md5').update(s).digest('hex');
}
/** Data URI for the PNG thumbnail of the resource from Godot cache; or null if not found or cancelled. */
export async function resThumb(resUri: Uri, token: CancellationToken) {
  if (resUri.scheme != 'file') return null;
  // Thumbnail max is 64x64 px = ~16KiB max, far less than the ~74kB MarkdownString base64 limit; ok to embed
  const resPathHash = md5(resUri.fsPath
    .replace(/^[a-z]:/, g0 => g0.toUpperCase()).replaceAll('\\', '/'));
  if (!resPathHash) return null; // in browser, would not be able to access Godot cache files anyway
  const platform = process.platform;
  const cachePaths = workspace.getConfiguration('godotFiles')
    .get<{ [platform: string]: string[]; }>('godotCachePath')![platform] ?? [];
  let lastThumbUri = null, lastModifiedTime = -Infinity;
  for (const cachePathString of cachePaths) {
    const cachePath = cachePathString.replace(/^~(?=\/)|\$\{userHome\}/g, g0 => homeDir ?? g0)
      .replace(/\$\{env:(\w+)\}/g, (g0, g1) => process.env[g1] ?? g0)
      .replace(/\$\{workspaceFolder(?::(.*?))?\}/g, (g0, g1) => !g1
        ? (workspace.getWorkspaceFolder(resUri) ?? workspace.workspaceFolders?.[0])?.uri.fsPath ?? g0
        : workspace.workspaceFolders?.find(f => f.name == g1)?.uri.fsPath ?? g0
      );
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

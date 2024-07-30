// Godot Project Helpers
import { workspace, Uri, FileStat, TextDocument, FileSystemError } from 'vscode';
const toUTF8 = new TextDecoder();

/** Find the root folder Uri of the closest Godot project containing the asset.
 * @param assetUri Uri of the asset file for which to locate the project.
 * @returns Uri of the project's root folder if found, or null if the asset is not inside a project.
 */
export async function projectDir(assetUri: Uri) {
  if (!resScheme.has(assetUri.scheme)) return null;
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
export interface GodotVersion { major: number; minor?: number; api?: string; dotnet: boolean; }
const projGodotVersionRegex = /^\s*config\/features\s*=\s*PackedStringArray\s*\(\s*(.*?)\s*\)\s*(?:[;#].*)?$/m;
/** Get the Godot version of the project on the specified folder.
 * @param projectDirUri Uri of the folder containing the project.godot file.
 * @returns An object with versions (major, and if found, minor too) or null if not found.
 */
export async function godotVersionOfProject(projectDirUri: Uri): Promise<GodotVersion | null> {
  let projMeta: string;
  try {
    projMeta = toUTF8.decode(await workspace.fs.readFile(Uri.joinPath(projectDirUri, 'project.godot')));
  } catch { return null; }
  let m = projMeta.match(projGodotVersionRegex), dotnet = false;
  if (m && m[1]) {
    const features = m[1].split(/\s*,\s*/g).map(s => s.replace(/^"([^"\\]*)"$/, '$1'));
    if (features.includes('C#')) dotnet = true;
    m = features.map(s => s.match(/^((\d+)\.(\d+).*)$/)).find(m => m)!;
    if (m && m[1]) return { api: m[1], major: +m[2], minor: +m[3], dotnet };
  }
  if (!dotnet) try {
    m = projMeta.match(/^\[dotnet\]\s*^\s*project\/assembly_name\s*=\s*"([^"\\]*)"\s*(?:[;#].*)?$/) ??
      projMeta.match(/^\[application\]\s*^\s*config\/name\s*=\s*"([^"\\]*)"\s*(?:[;#].*)?$/);
    const csProjName = m![1] + '.csproj';
    const csProj = toUTF8.decode(await workspace.fs.readFile(Uri.joinPath(projectDirUri, csProjName)));
    dotnet = true;
    m = csProj.match(/^<Project\s+Sdk\s*=\s*["']Godot\.NET\.Sdk\/((\d+)\.(\d+))(?:[^"'\\]*?)?["']>/i)!;
    return { api: m[1], major: +m[2], minor: +m[3], dotnet };
  } catch { /**/ }
  m = projMeta.match(/^\s*config_version\s*=\s*(\d+)\s*(?:[;#].*)?$/m);
  if (!m || !m[1]) return null;
  const configVersion = +m[1];
  if (configVersion == 5) return { major: 4, dotnet };
  if (configVersion == 4) return { major: 3, dotnet };
  return null;
}
const assetGodotVersionRegex =
  /^\s*\[\s*gd_(?:resource|scene)(?:\s+\w+=(?:\d+|".*?"))*?\s+format=(\d+)\b.*?\]\s*(?:[;#].*)?$/m;
  /** Get the Godot version of the project with the specified document.
   * @param document Text document of the asset.
   * @returns An object with versions (major, and if found, minor too) or null if not found.
   */
export async function godotVersionOfDocument(document: TextDocument | Uri): Promise<GodotVersion | null> {
  const projDir = await projectDir(document instanceof Uri ? document : document.uri);
  if (projDir) {
    const version = await godotVersionOfProject(projDir);
    if (version) return version;
  }
  if (document instanceof Uri) return null;
  const text = document.getText();
  const m = text.match(assetGodotVersionRegex);
  if (!m || !m[1]) return null;
  const format = +m[1];
  const dotnet = /^\[ext_resource\s+type="Script"\s+path="[^"\\]*\.[cC][sS]".*?\]\s*(?:[;#].*)?$/.test(text);
  switch (format) {
    case 4: case 3: return { major: 4, dotnet };
    case 2: return { major: 3, dotnet };
    case 1: return { major: 2, dotnet };
  }
  return null;
}
/** URL schemes where you can get a project dir for an asset. */
const resScheme = new Set(['file', 'vscode-file', 'vscode-remote', 'vscode-remote-resource']);
export async function resPathOfDocument(document: TextDocument) {
  const assetUri = document.uri;
  const assetPath = assetUri.path;
  const projDir = await projectDir(assetUri);
  if (projDir && assetPath.startsWith(projDir.path))
    return 'res:/' + assetPath.replace(projDir.path, ''); // remove proj path at the start to make it relative to proj
  return assetPath.replace(/^(?:.*\/)+/, ''); // fallback to document file name (relative path)
}
const uriRegex = /^[a-zA-Z][a-zA-Z0-9.+-]*:\/\/[^\x00-\x1F "<>\\^`{|}\x7F-\x9F]*$/;
interface UriFound { uri: Uri; stat: FileStat; }
/** Locates a resource by path string referenced in an asset document.
 * @param resPath Path of resource to locate. Can be relative to the document or to its project's root.
 * @param document Asset where path is. Its location and project are used as context to resolve the res path.
 * @returns Uri of the resource if it's found, or that URI as a string if file is not found.
 * @throws Error if any error happens other than FileNotFound.
 */
export async function locateResPath(resPath: string, document: TextDocument): Promise<string | UriFound> {
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

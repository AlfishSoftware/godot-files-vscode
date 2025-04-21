// Godot Project Helpers
import { workspace, Uri, FileStat, TextDocument, FileSystemError } from 'vscode';
import { parseBinaryUidCache, uidPathToNum } from './GodotUid';
import GodotFiles from './ExtensionEntry';
import GDAsset from './GDAsset/GDAsset';

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

/** In a config file, remove comments and ensure strings use single-line syntax (escape newline chars). */
function simplifyConfigFile(configFileText: string) {
  return configFileText.replace(/("(?:\\[^]|[^"\\])*")|;.*?$/mg, (_0, g1?: string) =>
    !g1 ? '' : g1.replace(/\r?\n/g, g0 => g0 == '\r\n' ? '\\r\\n' : '\\n')
  )
}
/** Get a value from config file by its `section/field` key. Only primitive values are supported. */
function parseConfigProperty(configFileText: string, prop: string) {
  const h = prop.indexOf('/');
  const header = h < 0 ? '' : prop.substring(0, h), field = prop.substring(h + 1);
  const configText = simplifyConfigFile(configFileText);
  let a = header ? null : 0, b;
  for (const m of configText.matchAll(/^\s*\[[ \t]*(\w+(?:[-./: ]\w+)*)[ \t]*\]$/mg)) {
    if (a == null) { if (m[1] == header) a = m.index + m[0].length; } else b = m.index;
  }
  if (a == null) return undefined; // section not found
  const sectionText = configText.substring(a, b);
  for (const m of sectionText.matchAll(/^\s*(\w+(?:[-./:]\w+)*)\s*=\s*/mg)) if (m[1] == field) try {
    const v = sectionText.substring(m.index + m[0].length); // text that starts at the correct field's value
    if (/^[&^]?"/.test(v)) {
      a = v[0] == '"' ? 1 : 2; b = v.length;
      for (let i = a; i < b; i++) {
        const c = v[i]!;
        if (c == '\\') { i++; continue; }
        if (c == '"') return GDAsset.unescapeString(v.substring(a, i));
      }
      return undefined; // unterminated string literal
    }
    if (/^null\b/.test(v)) return null;
    if (/^false\b/.test(v)) return false;
    if (/^true\b/.test(v)) return true;
    if (/^(?:nan|NAN)\b/.test(v)) return NaN;
    if (/^\+?(?:inf|INF)\b/.test(v)) return Infinity;
    if (/^(?:inf_neg|-inf|-INF)\b/.test(v)) return -Infinity;
    if (/^[-+]?(?:\.\d+|\d+[.eE])/.test(v)) return parseFloat(v);
    const mInt = /^[-+]?\d+\b/.exec(v); if (mInt) return BigInt(mInt[0]);
    return Symbol() // field found, but value is unsupported or invalid
  } catch { return undefined; } // syntax error when parsing value
  return undefined; // field not found in this section
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
    if (m && m[1]) return { api: m[1], major: +m[2]!, minor: +m[3]!, dotnet };
  }
  if (!dotnet) try {
    m = projMeta.match(/^\[dotnet\]\s*^\s*project\/assembly_name\s*=\s*"([^"\\]*)"\s*(?:[;#].*)?$/) ??
      projMeta.match(/^\[application\]\s*^\s*config\/name\s*=\s*"([^"\\]*)"\s*(?:[;#].*)?$/);
    const csProjName = m![1] + '.csproj';
    const csProj = toUTF8.decode(await workspace.fs.readFile(Uri.joinPath(projectDirUri, csProjName)));
    dotnet = true;
    if (m = csProj.match(/^<Project\s+Sdk\s*=\s*["']Godot\.NET\.Sdk\/((\d+)\.(\d+))(?:[^"'\\]*?)?["']>/i))
      return { api: m[1], major: +m[2]!, minor: +m[3]!, dotnet };
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
export async function resPathOfDocument(documentUri: Uri) {
  const assetPath = documentUri.path;
  const projDir = await projectDir(documentUri);
  if (projDir && assetPath.startsWith(projDir.path))
    return 'res:/' + assetPath.replace(projDir.path, ''); // remove proj path at the start to make it relative to proj
  return assetPath.replace(/^(?:.*\/)+/, ''); // fallback to document file name (relative path)
}
const uriRegex = /^[a-zA-Z][a-zA-Z0-9.+-]*:\/\/[^\x00-\x1F "<>\\^`{|}\x7F-\x9F]*$/;
interface UriFound { uri: Uri; stat: FileStat; }
/** Locates a resource by path string referenced in an asset document.
 * @param resPath Path of resource to locate. Can be relative to the document or to its project's root.
 * @param assetUri Location of asset where path is. Its path and project are used as context to resolve the res path.
 * @returns Uri of the resource if it's found, or that URI as a string if file is not found.
 * @throws Error if any error happens other than FileNotFound.
 */
export async function locateResPath(resPath: string, assetUri: Uri): Promise<string | UriFound> {
  let resUri: Uri;
  resPath = resPath.replace(/::[^:/\\]*$/, '');
  if (/^(?:res|uid):\/\//.test(resPath)) {
    const projDir = await projectDir(assetUri);
    if (!projDir) return resPath; // no project.godot found, res and uid paths cannot be resolved
    if (resPath.startsWith('uid://')) {
      const resolvedPath = await resolveUidInProject(resPath, projDir);
      if (!resolvedPath) return resPath; // if uid mapping not found, cannot load
      resPath = resolvedPath;
    }
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
      return resUri.toString(true);
    throw err;
  }
}

export async function resolveUidInDocument(uidPath: string, documentUri: Uri) {
  if (!GodotFiles.supported) return null;
  const projDir = await projectDir(documentUri);
  if (!projDir) return null; // no project.godot found, uid paths cannot be resolved
  return await resolveUidInProject(uidPath, projDir);
}
export async function resolveUidInProject(uidPath: string, projectDirUri: Uri) {
  if (!GodotFiles.supported) return null;
  const resolvedPath = (await getUidCache(projectDirUri)).get(uidPathToNum(uidPath));
  return resolvedPath?.startsWith('res:') ? resolvedPath : null;
}

/** Read the uid cache binary file as a sequence of bytes, then parse it and return it as a map.
 * @param projectDirUri Uri of the folder containing the project.godot file.
 */
async function getUidCache(projectDirUri: Uri) {
  const cacheKey = projectDirUri.toString(true);
  const cachedValue = cachedUidMaps.get(cacheKey);
  if (cachedValue && cachedValue.lastModified >= Date.now() - 5000) return cachedValue.map;
  try {
    const genDir = await godotGenDir(projectDirUri);
    if (!genDir.endsWith('godot')) throw null;
    const fileUri = Uri.joinPath(projectDirUri, genDir, 'uid_cache.bin');
    const { mtime: lastModified } = await workspace.fs.stat(fileUri);
    if (cachedValue && cachedValue.lastModified >= lastModified) return cachedValue.map;
    // else cache_uid.bin has changed, parse and update local cached UidMap
    const { buffer } = await workspace.fs.readFile(fileUri);
    const map = parseBinaryUidCache(buffer);
    cachedUidMaps.set(cacheKey, { lastModified, map });
    return map;
  } catch { return new Map<bigint, string>(); }
}
interface UidMap { lastModified: number; map: Map<bigint, string>; }
const cachedUidMaps = new Map<string, UidMap>();

/** Get the folder name of the generated files, as per the project settings and Godot version.
 * @param projectDirUri Uri of the folder containing the project.godot file.
 */
async function godotGenDir(projectDirUri: Uri) {
  let hidden = true, configVersion = 0n;
  try {
    const proj = toUTF8.decode(await workspace.fs.readFile(Uri.joinPath(projectDirUri, 'project.godot')));
    configVersion = BigInt(parseConfigProperty(proj, '/config_version') as bigint)
    hidden = !!(parseConfigProperty(proj, 'application/config/use_hidden_project_data_directory') ?? true);
  } catch { /* assume .godot on any error */ }
  if (configVersion >= 5) return hidden ? '.godot' : 'godot';
  else return hidden ? '.import' : 'import';
}

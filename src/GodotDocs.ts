// Godot Docs
import {
  workspace, window, commands, extensions, env, Uri, CancellationToken, TextDocument, Position, Location,
  WebviewPanel, CustomDocument, CustomDocumentOpenContext, CustomReadonlyEditorProvider,
} from 'vscode';
import { isOnline } from './+cross/Platform';
import { ctx, supported } from './ExtensionEntry';
import { GodotVersion, godotVersionOfDocument, godotVersionOfProject } from './GodotProject';
const toUTF8 = new TextDecoder();

const onlineDocsHost = 'docs.godotengine.org';
const latestApiGodot3 = '3.6';
const latestApiGodot2 = '2.1';
function apiVersion(gdVersion: GodotVersion | null) {
  if (gdVersion == null) return 'stable';
  if (gdVersion.api) return gdVersion.api;
  const major = gdVersion.major;
  return major <= 2 ? latestApiGodot2 : major == 3 ? latestApiGodot3 : 'stable';
}
// const docsLocales = ['en', 'cs', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-br', 'ru', 'uk', 'zh-cn', 'zh-tw'];
interface BrowserHistory {
  overrideFragment?: string;
  currentUri: string;
  back: string[]; forward: string[];
}
export class GodotDocumentationProvider implements CustomReadonlyEditorProvider
{
  static readonly viewType = 'godotFiles.docsBrowser';
  static readonly webviewPanels = new Map<string, WebviewPanel>();
  private static readonly navigationHistory = new Map<string, BrowserHistory>();
  static readonly detectedDotnetBuffer = new Map<string, boolean>();
  static parseUri(uri: Uri) {
    const { path, fragment } = uri;
    const [, viewer, urlPath, title] = path.match(/^.*?\/godot-docs\.([\w-]+)\.ide:\/(.*?)\/([^/]+)$/) ?? [];
    const urlFragment = fragment ? '#' + fragment : '';
    return { path, viewer, urlPath, title, fragment, urlFragment };
  }
  static parseUrlPath(urlPath: string) {
    const [, locale, version, page] = urlPath.match(/^([\w-]+)\/([^/]+)\/([^#]+\.html)$/)
      ?? ['', 'en', 'stable', '404.html'];
    return { locale, version, page };
  }
  static setCanNavigate(history: BrowserHistory | false) {
    const canGoBack = history && history.back.length != 0;
    const canGoForward = history && history.forward.length != 0;
    commands.executeCommand('setContext', 'godotFiles.activeDocsPage.canNavigateBack', canGoBack);
    commands.executeCommand('setContext', 'godotFiles.activeDocsPage.canNavigateForward', canGoForward);
  }
  static getHistory(uri: string) {
    // get existing, e.g. from a link navigation; or init history
    return GodotDocumentationProvider.navigationHistory.get(uri) ?? { currentUri: uri, back: [], forward: [] };
  }
  static setHistory(history: BrowserHistory) {
    GodotDocumentationProvider.navigationHistory.set(history.currentUri, history);
  }
  async openCustomDocument(uri: Uri, openContext: CustomDocumentOpenContext, token: CancellationToken
  ): Promise<CustomDocument> {
    return { uri: uri, dispose() {}, };
  }
  async resolveCustomEditor(document: CustomDocument, webviewPanel: WebviewPanel, token: CancellationToken
  ): Promise<void> {
    const docsPageUri = document.uri, uriString = docsPageUri.toString();
    // set history when it opens a new tab from link navigation
    const history = GodotDocumentationProvider.getHistory(uriString);
    GodotDocumentationProvider.setCanNavigate(history);
    webviewPanel.onDidChangeViewState(event => {
      if (!event.webviewPanel.active) return;
      const history = GodotDocumentationProvider.getHistory(uriString);
      // also append history from link click when it switches back to this tab, when it was already open
      if (history.back.length != 0)
        history.back.unshift(uriString);
      if (history.forward.length != 0)
        history.forward.push(uriString);
      GodotDocumentationProvider.setCanNavigate(history);
    });
    GodotDocumentationProvider.webviewPanels.set(uriString, webviewPanel);
    const dotnet = GodotDocumentationProvider.detectedDotnetBuffer.get(uriString);
    GodotDocumentationProvider.detectedDotnetBuffer.delete(uriString);
    webviewPanel.onDidDispose(() => {
      GodotDocumentationProvider.webviewPanels.delete(uriString);
      GodotDocumentationProvider.navigationHistory.delete(uriString);
    });
    const { path, viewer, urlPath, title, urlFragment } = GodotDocumentationProvider.parseUri(docsPageUri);
    if (viewer == 'webview') {
      try {
        await loadDocsInTab(urlPath, urlFragment, dotnet, webviewPanel, history, token);
        return;
      } catch (e) { console.error(e); throw e; }
    } else if (viewer == 'browser') {
      const url = `https://${onlineDocsHost}/${urlPath}${urlFragment}`;
      if (!await env.openExternal(Uri.parse(url, true)))
        window.showErrorMessage(`Could not open documentation for "${title}" in browser. URL: ${url}`);
    } else window.showErrorMessage('Documentation viewer could not open path: ' + path);
    webviewPanel.dispose();
  }
}
const pos0 = new Position(0, 0);
export async function apiDocs(
  document: TextDocument, className: string, memberName: string, token: CancellationToken | null
) {
  const config = workspace.getConfiguration('godotFiles', document);
  const viewer = supported ? config.get<string>('documentation.viewer')! : 'godot-tools';
  if (viewer != 'godot-tools' && await isOnline(onlineDocsHost)) {
    // We could get locale properly, but it seems other locales don't support every version consistently.
    // Also the API will probably still be in english even in those locales.
    // const locale = env.language.toLowerCase();
    // let apiLocale: string;
    // if (docsLocales.includes(locale)) apiLocale = locale;
    // else {
    //   const lang = locale.replace(/[-_].*$/, '');
    //   apiLocale = docsLocales.includes(lang) ? lang : 'en';
    // }
    const apiLocale = 'en';
    const gdVersion = await godotVersionOfDocument(document);
    if (token?.isCancellationRequested) return null;
    try {
      const docUri = apiDocsPageUri(className, memberName, gdVersion, apiLocale, viewer);
      if (viewer == 'webview')
        GodotDocumentationProvider.detectedDotnetBuffer.set(docUri.toString(), !!gdVersion?.dotnet);
      return new Location(docUri, pos0);
    } catch (e) { console.error(e); }
  } else if (extensions.getExtension('geequlim.godot-tools')?.isActive) {
    const uri = Uri.from({ scheme: 'gddoc', path: className + '.gddoc', fragment: memberName || undefined });
    return new Location(uri, pos0);
  }
  const reason: string = viewer == 'godot-tools' ? 'Is the godot-tools extension running?' : 'Are you online?';
  window.showErrorMessage(`Could not open documentation for ${className}. ${reason}`);
  return null;
}
function apiDocsPageUri(
  className: string, memberName: string, gdVersion: GodotVersion | null, locale: string, viewer: string,
) {
  const version = apiVersion(gdVersion);
  const classLower = className.toLowerCase();
  const page = `classes/class_${classLower}.html`;
  const fragment = '#class-' + classLower + (!memberName ? '' :
    `-${version == '3.0' || version == '2.1' ? '' : 'property-'}${memberName.replaceAll('_', '-')}`);
  return docsPageUri(viewer, `${locale}/${version}/${page}`, className, fragment);
}
function docsPageUri(viewer: string, urlPath: string, title: string, fragment: string) {
  const filename = encodeURIComponent(title);
  return Uri.parse(`untitled:${ctx.extension.id}/godot-docs.${viewer}.ide:/${urlPath}/${filename}${fragment}`);
}

interface GodotDocsPage { docsUrl: string; title: string; html: string; }
const docsPageCache = new Map<string, GodotDocsPage>();
async function fetchDocsPage(urlPath: string, token: CancellationToken | null): Promise<GodotDocsPage> {
  const docsUrl = `https://${onlineDocsHost}/${urlPath}`;
  let response; try {
    response = await fetch(docsUrl);
  } catch (e) {
    const cause = (e as { cause: unknown; })?.cause;
    if (cause) console.error(cause);
    throw e;
  }
  if (!response.ok) {
    const e = new Error(`Error fetching Godot docs: ${response.status} (${response.statusText}) ${docsUrl}`);
    console.error(e);
    throw e;
  }
  if (token?.isCancellationRequested) return { docsUrl, title: '', html: '' };
  const html = await response.text();
  const title = (
    html.match(/<meta\s+property\s*=\s*"og:title"\s+content\s*=\s*"(.*?)(?: \u2013[^"]*)?"\s*\/?>/i)?.[1] ||
    html.match(/<title>(.*?)(?: &mdash;[^<]*)?<\/title>/i)?.[1] || 'Godot Docs'
  ).replaceAll('/', '\u29F8');
  return { docsUrl, title, html };
}
async function loadDocsInTab(urlPath: string, urlFragment: string, dotnet: boolean | undefined,
  webviewPanel: WebviewPanel, history: BrowserHistory, token: CancellationToken | null
) {
  const cachedPage = docsPageCache.get(urlPath);
  if (cachedPage) docsPageCache.delete(urlPath);
  let docsPage;
  try {
    docsPage = cachedPage ?? await fetchDocsPage(urlPath, token);
  } catch (e) {
    const docsUrlFull = `https://${onlineDocsHost}/${urlPath}${urlFragment}`;
    console.error('Godot Files :: Failed to fetch in docs webview: ' + docsUrlFull);
    webviewPanel.webview.html = `<!DOCTYPE html><html lang="en"><head><style>html, body, div { height: 100%; }
div { display: flex; align-items: center; justify-content: center; text-align: center; }
</style><meta http-equiv="Content-Security-Policy" content="default-src 'none';"></head><body><div><span>
<p>Could not open documentation. Are you online?</p>
<a href="${docsUrlFull.replace(/\\|"/g, '\\$&')}">${docsUrlFull.replaceAll('<', '&lt;')}</a>
</span></div></body></html>`;
    return;
  }
  const { docsUrl, title, html } = docsPage;
  console.info('Godot Files :: Fetched in docs webview: ' + docsUrl + urlFragment);
  if (token?.isCancellationRequested) return;
  const { locale, page } = GodotDocumentationProvider.parseUrlPath(urlPath);
  let className = '';
  //let iconUrl = '';
  if (page.match(/^classes\/class_(@?\w+)\.html(?:\?.*)?$/)?.[1] == title.toLowerCase()) {
    className = title;
    // This would get the same icon for the class used in the Godot Editor.
    //const old = /^[32]\.\w+/.test(version);
    //const ghBranch = old ? '3.x' : version.startsWith('4.') ? version : 'master';
    //const iconName = old ? 'icon_' + snakeCase(className) : className;
    //iconUrl = `https://raw.githubusercontent.com/godotengine/godot/${ghBranch}/editor/icons/${iconName}.svg`;
  }
  const classLower = className.toLowerCase();
  // Would use a 3rd-party icon. Instead, get a generic docs icon from the extension itself.
  //const iconPath = (iconUrl ? await fetchAsDataUri(iconUrl) : null) ??
  //  Uri.from({ scheme: 'https', authority: onlineDocsHost, path: '/favicon.ico' });
  //if (token?.isCancellationRequested) return;
  const webview = webviewPanel.webview;
  webview.options = { localResourceRoots: [], enableScripts: true };
  webview.onDidReceiveMessage(msg => onDocsTabMessage(msg, webviewPanel, history));
  const p = `https://${onlineDocsHost.replace(/^docs\./, '*.')}/${locale}/`;
  const csp = `default-src data: https:; script-src 'unsafe-inline' ${p}; style-src 'unsafe-inline' ${p}`;
  const docsWebviewSettings = workspace.getConfiguration('godotFiles.documentation.webview');
  const hideNav = page != 'index.html' && docsWebviewSettings.get<boolean>('hideSidebar')!;
  const injectHead = hideNav ? `<style>
body.wy-body-for-nav { margin: unset }
nav.wy-nav-top, nav.wy-nav-side, div.rst-versions, div.rst-footer-buttons { display: none }
section.wy-nav-content-wrap, div.wy-nav-content { margin: auto }
</style>` : '';
  const codeLang = dotnet ? 'C#' : dotnet == false ? 'GDScript' : '';
  const isPast = history.forward.length != 0;
  const canRedirect = !isPast && docsWebviewSettings.get<boolean>('redirectInheritedMember')! ? '^' : '';
  const template = docsWebviewInjectHtmlTemplate ?? (docsWebviewInjectHtmlTemplate = toUTF8.decode(
    await workspace.fs.readFile(Uri.joinPath(ctx.extensionUri, 'lang.godot-docs/godot-docs-webview.inject.htm'))
  ));
  const insertVar: { [key: string]: string; } =
    { docsUrl, injectHead, urlFragment, classLower, locale, csp, codeLang, canRedirect };
  const injectedHead = template.replace(/%\{(\w+)\}/g, (_s, v) => insertVar[v] ?? '');
  const pageId = page.replace(/\.html(?:\?.*)?$/, '');
  const userNotes = `Open this page in your external browser to load comments, or <a href="\
https://github.com/godotengine/godot-docs-user-notes/discussions/categories/user-contributed-notes?discussions_q=\
%22${encodeURIComponent(pageId)}%22">find its discussion on GitHub</a> if available.<br/>`;
  const finalHtml = html
    // Inject HTML file with code and style on head
    .replace(/(?<=<head>\s*(?:<meta\s+charset\s*=\s*["']utf-8["']\s*\/?>)?)/i, injectedHead)
    // Insert text on user-submitted notes to explain why it's empty (iframe won't load since it wouldn't work)
    .replace(/(?<=<div\s+id\s*=\s*["']godot-giscus["']>\s*<hr\s*\/?>\s*<h2>\s*[\w\s-]*\s*<\/h2>\s*<p>)/i, userNotes);
  if (webview.html) webview.html = '';
  webview.html = finalHtml;
}
let docsWebviewInjectHtmlTemplate: string | undefined;

interface GodotDocsMessage { navigateTo?: string; newFragment?: string; }
async function onDocsTabMessage(
  msg: GodotDocsMessage, webviewPanel: WebviewPanel, history: BrowserHistory) {
  if (msg.navigateTo != undefined) {
    const exitUri = await docsTabMsgNavigate(msg as GodotDocsMessageNavigate);
    if (exitUri) {
      const destination = exitUri.toString();
      GodotDocumentationProvider.setHistory({
        currentUri: destination, back: history.back.concat(history.currentUri), forward: []
      });
      await commands.executeCommand('vscode.openWith', exitUri, GodotDocumentationProvider.viewType);
      webviewPanel.dispose();
    }
  } else if (msg.newFragment != undefined) {
    history.overrideFragment = msg.newFragment;
  } else console.error('Godot Files :: Unknown message: ', msg);
}
interface GodotDocsMessageNavigate { navigateTo: string; exitThisPage?: boolean; }
async function docsTabMsgNavigate(msg: GodotDocsMessageNavigate) {
  const origin = `https://${onlineDocsHost}/`;
  const url = msg.navigateTo.replace(/^http:/i, 'https:')
    .replace(/^vscode-webview:\/\/[^/]*\/index\.html\//, origin + 'en/');
  if (!url.startsWith('https:')) { console.warn('Refusing to navigate to this scheme: ' + url); return null; }
  let m;
  if (!url.startsWith(origin) || !(m =
    url.substring(origin.length).replace(/\/(?=(?:#.*)?$)/, '/index.html').match(/^([\w-]+\/[^/]+\/[^#]+\.html)(#.*)?$/)
  )) {
    if (!await env.openExternal(Uri.parse(url, true)))
      window.showErrorMessage('Could not open URL in browser: ' + url);
    return null;
  }
  const [, urlPath, fragment] = m;
  try {
    const docsPage = await fetchDocsPage(urlPath, null);
    docsPageCache.set(urlPath, docsPage);
    const docUri = docsPageUri('webview', `${urlPath}`, docsPage.title, fragment ?? '');
    const exit = msg.exitThisPage &&
      !workspace.getConfiguration('godotFiles.documentation.webview').get<boolean>('keepTabs')!;
    if (exit) return docUri; // to replace current tab
    await commands.executeCommand('vscode.openWith', docUri, GodotDocumentationProvider.viewType);
    return null; // don't replace current tab
  } catch (e) {
    console.error(e);
    window.showErrorMessage('Could not open URL in webview: ' + url, 'Open in browser').then(async (btn) => {
      if (btn && !await env.openExternal(Uri.parse(url, true)))
        window.showErrorMessage('Could not open URL in browser: ' + url);
    });
    return null;
  }
}

interface TabInputUnknown { readonly ['uri']?: Uri; readonly ['modified']?: Uri; readonly ['viewType']?: string; }
export async function openApiDocs() {
  if (!supported) { window.showErrorMessage('Only available in early access.'); return; }
  const document = window.activeTextEditor?.document;
  let configScope, gdVersion;
  if (document) {
    configScope = document;
    gdVersion = await godotVersionOfDocument(document);
  } else {
    const t = window.tabGroups.activeTabGroup.activeTab?.input as TabInputUnknown | undefined;
    const activeTabUri = t && (t['uri'] ?? t['modified']);
    if (activeTabUri && t['viewType'] == GodotDocumentationProvider.viewType) {
      const { locale, version } =
        GodotDocumentationProvider.parseUrlPath(GodotDocumentationProvider.parseUri(activeTabUri).urlPath);
      const docUri = docsPageUri('webview', `${locale}/${version}/classes/index.html`, 'All classes', '');
      await commands.executeCommand('vscode.openWith', docUri, GodotDocumentationProvider.viewType);
      return;
    }
    const workspaceFolder = (activeTabUri && workspace.getWorkspaceFolder(activeTabUri))
      ?? workspace.workspaceFolders?.[0];
    configScope = activeTabUri ?? workspaceFolder;
    gdVersion = (activeTabUri && await godotVersionOfDocument(activeTabUri))
      ?? (workspaceFolder ? await godotVersionOfProject(workspaceFolder.uri) : null);
  }
  const viewer = workspace.getConfiguration('godotFiles.documentation', configScope)
    .get<string>('viewer')! == 'webview' ? 'webview' : 'browser';
  const locale = 'en';
  const version = apiVersion(gdVersion);
  const docUri = docsPageUri(viewer, `${locale}/${version}/classes/index.html`, 'All classes', '');
  if (viewer == 'webview')
    GodotDocumentationProvider.detectedDotnetBuffer.set(docUri.toString(), !!gdVersion?.dotnet);
  await commands.executeCommand('vscode.openWith', docUri, GodotDocumentationProvider.viewType);
}
function getActiveDocsUri() {
  // check active tab group first, as it should be the one activating the command
  const t = window.tabGroups.activeTabGroup.activeTab?.input as TabInputUnknown | undefined;
  if (t && t['viewType'] == GodotDocumentationProvider.viewType && t['uri']) return t['uri'];
  // weirdly, aux window commands may run without being considered the active tab group (bug?), so check all tab groups
  for (const tabGroup of window.tabGroups.all) {
    const t = tabGroup.activeTab?.input as TabInputUnknown | undefined;
    if (t && t['viewType'] == GodotDocumentationProvider.viewType && t['uri']) return t['uri'];
  }
  window.showErrorMessage('Could not find an URI of an active Godot Docs Page tab! (Floating window?)');
  throw new Error();
}
async function activeDocsNavigateHistory(delta: -1 | 1) {
  const docsTabUri = getActiveDocsUri(), uriString = docsTabUri.toString();
  const webviewPanel = GodotDocumentationProvider.webviewPanels.get(uriString);
  const history = GodotDocumentationProvider.getHistory(uriString);
  if (!webviewPanel) {
    console.error('WebviewPanel not found! URI: ' + uriString);
    GodotDocumentationProvider.setCanNavigate(false);
    return;
  }
  let destinationUriString;
  if (delta < 0) {
    destinationUriString = history.back.pop();
    if (!destinationUriString) return;
    history.forward.unshift(history.currentUri);
  } else {
    destinationUriString = history.forward.shift();
    if (!destinationUriString) return;
    history.back.push(history.currentUri);
  }
  history.currentUri = destinationUriString;
  GodotDocumentationProvider.setHistory(history);
  const destinationUri = Uri.parse(destinationUriString, true);
  await commands.executeCommand('vscode.openWith', destinationUri, GodotDocumentationProvider.viewType);
  webviewPanel.dispose();
}
export async function activeDocsGoBack() {
  await activeDocsNavigateHistory(-1);
}
export async function activeDocsGoForward() {
  await activeDocsNavigateHistory(1);
}
export async function activeDocsReload() {
  const docsTabUri = getActiveDocsUri(), uriString = docsTabUri.toString();
  const webviewPanel = GodotDocumentationProvider.webviewPanels.get(uriString);
  const history = GodotDocumentationProvider.getHistory(uriString);
  if (!webviewPanel) {
    console.error('WebviewPanel not found! URI: ' + uriString);
    const btn = await window.showErrorMessage(
      'Cannot find the tab handle to reload. Close it manually, then reopen.', 'Reopen as new tab');
    if (btn) await commands.executeCommand('vscode.openWith', docsTabUri, GodotDocumentationProvider.viewType);
    return;
  }
  const newFragment = history.overrideFragment;
  const { urlPath, urlFragment } = GodotDocumentationProvider.parseUri(docsTabUri);
  const newUrlFragment = newFragment != undefined ? '#' + newFragment : urlFragment;
  const dotnet = GodotDocumentationProvider.detectedDotnetBuffer.get(uriString);
  GodotDocumentationProvider.detectedDotnetBuffer.delete(uriString);
  await loadDocsInTab(urlPath, newUrlFragment, dotnet, webviewPanel, history, null);
}
export async function activeDocsOpenInBrowser() {
  const docsTabUri = getActiveDocsUri(), uriString = docsTabUri.toString();
  const history = GodotDocumentationProvider.getHistory(uriString);
  const newFragment = history.overrideFragment;
  const { urlPath, fragment } = GodotDocumentationProvider.parseUri(docsTabUri);
  const url = Uri.from({
    scheme: 'https', authority: onlineDocsHost, path: '/' + urlPath, fragment: newFragment ?? fragment
  });
  if (!await env.openExternal(url))
    window.showErrorMessage('Could not open URL in browser: ' + url);
}
export async function activeDocsFindNext() {
  await commands.executeCommand('editor.action.webvieweditor.findNext');
  // NOTE: this is focusing the find field, where it cannot be run again until the page is focused again
}
export async function activeDocsFindPrevious() {
  await commands.executeCommand('editor.action.webvieweditor.findPrevious');
  // NOTE: this is focusing the find field, where it cannot be run again until the page is focused again
}

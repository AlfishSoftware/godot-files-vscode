// Extension Entry

// imports that don't depend on this extension at all
import { workspace, window, commands, languages, env, ExtensionContext, Uri } from 'vscode';
import { sha512 } from './+cross/Platform';
import * as pc_Platform from './@pc/Platform';
const rmSync = pc_Platform.rmSync ?? (() => {});

export let ctx: ExtensionContext;
let supported = false;
export default {
  get supported() { return supported; },
  get refusedGDShaderOfferUntil() {
    return ctx.globalState.get<number>(gs_refusedGDShaderOfferUntil) ?? -Infinity;
  },
};
export async function refuseGDShaderOfferUntil(timestamp: number) {
  await ctx.globalState.update(gs_refusedGDShaderOfferUntil, timestamp);
}
export async function openSponsorUrl() {
  const url: string = ctx.extension.packageJSON.sponsor.url;
  if (!await env.openExternal(Uri.parse(url, true)))
    window.showErrorMessage(`Could not open the URL in the browser: ${url}`);
}

const gs_supportKey = 'supportKey';
const gs_refusedGDShaderOfferUntil = 'refusedGDShaderOfferUntil';

/** The extension entry point, which runs when the extension is enabled for the IDE window. */
export async function activate(context: ExtensionContext) {
  if (!workspace.isTrusted) {
    context.subscriptions.push(workspace.onDidGrantWorkspaceTrust(() => { activate(context); }));
    return;
  }
  ctx = context;
  ctx.globalState.setKeysForSync([]);
  // check if supporting
  if (ctx.globalState.get<string>(gs_supportKey) == checksum) supported = true;
  ctx.subscriptions.push(commands.registerCommand('godotFiles.unlockEarlyAccess', unlockEarlyAccess));
  
  // imports that may depend on this extension's state
  const { default: GDAssetProvider } = await import('./GDAsset/GDAssetProvider');
  const { default: GDShaderProvider } = await import('./GDShader/GDShaderProvider');
  const {
    GodotDocumentationProvider, openApiDocs, activeDocsFindNext, activeDocsFindPrevious,
    activeDocsGoBack, activeDocsGoForward, activeDocsReload, activeDocsOpenInBrowser,
  } = await import('./GodotDocs');
  // register multi-platform providers
  ctx.subscriptions.push(
    window.registerCustomEditorProvider(GodotDocumentationProvider.viewType, new GodotDocumentationProvider(), {
      webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true }
    }),
    commands.registerCommand('godotFiles.openApiDocs', openApiDocs),
    commands.registerCommand('godotFiles.activeDocsPage.navigateBack', activeDocsGoBack),
    commands.registerCommand('godotFiles.activeDocsPage.navigateForward', activeDocsGoForward),
    commands.registerCommand('godotFiles.activeDocsPage.reload', activeDocsReload),
    commands.registerCommand('godotFiles.activeDocsPage.openInBrowser', activeDocsOpenInBrowser),
    commands.registerCommand('godotFiles.activeDocsPage.findNext', activeDocsFindNext),
    commands.registerCommand('godotFiles.activeDocsPage.findPrevious', activeDocsFindPrevious),
  );
  const gdassetProvider = new GDAssetProvider();
  ctx.subscriptions.push(
    languages.registerDocumentSymbolProvider(GDAssetProvider.docs, gdassetProvider),
    languages.registerDefinitionProvider(GDAssetProvider.godotDocs, gdassetProvider),
    languages.registerHoverProvider(GDAssetProvider.godotDocs, gdassetProvider),
    languages.registerInlayHintsProvider(GDAssetProvider.godotDocs, gdassetProvider),
    languages.registerColorProvider(GDAssetProvider.godotDocs, gdassetProvider),
  );
  new GDShaderProvider(ctx);
}

async function unlockEarlyAccess() {
  if (supported) {
    if (await window.showInformationMessage('Early access is already enabled.', 'OK', 'Disable') == 'Disable') {
      supported = false;
      await ctx.globalState.update(gs_supportKey, undefined);
    }
    return;
  }
  const password = await window.showInputBox({
    title: 'Password to unlock early access:',
    placeHolder: 'A password is received when making a donation.',
    password: true,
    prompt: 'Check the README page for more info.'
  });
  const ok = 'Learn more';
  if (!password) {
    if (await window.showInformationMessage('You can donate to receive a password.', ok) == ok) await openSponsorUrl();
    return;
  }
  const hash = await sha512(password);
  if (hash != checksum) {
    const msg = 'Incorrect password. Paste it exactly like you received when donating.';
    if (await window.showErrorMessage(msg, ok) == ok) await openSponsorUrl();
    return;
  }
  supported = true;
  await ctx.globalState.update(gs_supportKey, hash);
  await ctx.globalState.update(gs_refusedGDShaderOfferUntil, undefined);
  window.showInformationMessage(
    'Thank you for the support! ❤️\nEarly access is now unlocked, just for you. 😊');
}
const checksum = '1ee835486c75add4e298d9120c62801254ecb9f69309f1f67af4d3495bdf7ba14e288b73298311f5ef7839ec34bfc12211a035911d3ad19a60e822a9f44d4d5c';

/** Runs to cleanup resources when extension is disabled. May not run in browser, and is limited to 5s.
 * VSCode APIs can be unusable here; it may run after renderer process is gone (closing IDE window).
 * Context subscriptions are disposed after this.
 */
export function deactivate() {
  const tmpUri = ctx?.logUri;
  if (!tmpUri) return;
  // try to delete tmp folder
  if (tmpUri.scheme == 'file') try {
    rmSync(tmpUri.fsPath, { force: true, recursive: true });
  } catch { /* ignore, logs should be auto-deleted eventually anyway */ }
}

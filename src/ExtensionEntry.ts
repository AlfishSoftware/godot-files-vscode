// Extension Entry
import { workspace, window, commands, languages, ExtensionContext, Uri } from 'vscode';
import { sha512 } from './+cross/Platform';
import * as pc_Platform from './@pc/Platform';
const rmSync = pc_Platform.rmSync ?? (() => {});
import GDAssetProvider from './GDAsset/GDAssetProvider';
import GDShaderProvider from './GDShader/GDShaderProvider';
import {
  GodotDocumentationProvider, openApiDocs, activeDocsFindNext, activeDocsFindPrevious,
  activeDocsGoBack, activeDocsGoForward, activeDocsReload, activeDocsOpenInBrowser,
} from './GodotDocs';

export let ctx: ExtensionContext;
export let supported = false;

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
  ctx.globalState.setKeysForSync([]);
  // check if supporting
  if (ctx.globalState.get('supportKey') == checksum) supported = true;
  ctx.subscriptions.push(commands.registerCommand('godotFiles.unlockEarlyAccess', unlockEarlyAccess));
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

const deleteRecursive = { recursive: true, useTrash: false };
/** Permanently delete a file or an entire folder. */
async function del(uri: Uri) {
  try { await workspace.fs.delete(uri, deleteRecursive); } catch { /* didn't exist */ }
}

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
  const hash = await sha512(password);
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

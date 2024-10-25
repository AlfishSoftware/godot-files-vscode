import {
  CancellationToken, TextDocumentContentProvider, Uri,
} from 'vscode';
import { GodotDocumentationProvider, onlineDocsHost } from './GodotDocs';

export default class GodotContentTextProvider implements TextDocumentContentProvider {
  async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | null> {
    const { path } = uri;
    if (path.match(/^.*?\/godot\.docs\.(?:[\w-]+):\//)) {
      const { urlPath, title, urlFragment } = GodotDocumentationProvider.parseUri(uri);
      const url = `https://${onlineDocsHost}/${urlPath}${urlFragment}`;
      return `${title}\n\n${url}\n`;
      // We could fetch the HTML or RST and show text here, like the description.
    }
    return null;
  }
}

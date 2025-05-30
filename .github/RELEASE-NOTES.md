**VSCode:** Available on [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=${publisher}.${name}).  
**Codium, etc.:** Available on [Open-VSX](https://open-vsx.org/extension/${publisher}/${name}/${version}).  
**Browser:** Available in [vscode.dev](https://vscode.dev) and [github.dev](https://github.dev), with limited functionality.  
Just search for "godot files" on the IDE's extension view.

You can also download the [extension file](https://github.com/${ghRepo}/releases/download/v${version}/${vsix}). This method won't give you automatic updates, so it's highly recommended that you follow this repo by clicking **Watch > Custom > Releases** to get notified on new releases. The downloaded file can be manually installed via command line:
```sh
code --install-extension ${vsix}
```

[Changelog](https://github.com/${ghRepo}/blob/v${version}/CHANGELOG.md)

This software is free and in the [public domain].  
🔑 Please [donate] to unlock features in early access, and to help this project not be abandoned!  
👍 If you think this is useful, please star this repo and rate the extension.  
🛒 [Itch Store] | [Unity Assets]

[public domain]: https://unlicense.org/
[donate]: https://alfish.itch.io/godot-files-vscode
[Itch Store]: https://alfish.itch.io/
[Unity Assets]: https://assetstore.unity.com/publishers/30331

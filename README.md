# Godot Files

Basic GDShader support, better syntax-coloring and additional features for some Godot files.  
This is *not* meant to replace the official [godot-tools] extension, but to improve on its supported files. This plugin is designed so it can work alongside it, but it's completely independent. If you're using GDScript, you'll likely want to install godot-tools too; if not, just this one is enough.

[godot-tools]: https://github.com/godotengine/godot-vscode-plugin

> 🥺 Please help prevent this extension from being abandoned by [donating to the crowdfunding][donate]!  
> 🔑 With a donation, you can **unlock early access and other rewards**! More info below.

![Showcasing various features, like GDShader errors, hovering, navigating and documentation pages](docs/showcase-all.png "* Features showcased here include those restricted to early access.")

**Compatibility**:

- Godot: 3.x LTS and 4.0 to 4.x; official and flathub builds
- godot-tools: v2.3.0

🌐 This extension also works on browser IDEs ([vscode.dev](https://vscode.dev) and [github.dev](https://github.dev)), with limited functionality.

## Features
Features are supported on these languages:
- **GDShader** files: `*.gdshader`, `*.gdshaderinc`.  
	> 🔒 GDShader Language features are finally available on [early access][donate]! See below.
- "**GDAsset**" files (this term is used here to describe all INI-like files used by Godot):  
	`project.godot`, `*.tscn`, `*.escn`, `*.tres`, `*.gdns`, `*.gdnlib`, `*.import`, `*.tet`, `*.remap`.
- "**Configuration Properties**" (`config-definition`), used for other specific non-Godot INI-like files:  
	`*.cfg`, Git config files (`.gitconfig`, `.git/config`) and XDG Desktop Entry files (`.desktop`, `.directory`).

Webview features:
- 🔒 **Godot Documentation Viewer** (on [early access][donate], see below).

### Syntax Highlighting
Includes better (more specific) grammars for syntax-coloring on all supported textual languages above.

"Configuration Properties" reuses the "GDAsset" grammar. It fits better than "INI" and "Properties" because it's "smarter" than regular INI. It supports sub-properties, literals (booleans, numbers, strings), quoted strings in section headers, `;`-separated lists, apostrophe (single quote) inside unquoted strings like `don't`, etc. You might want to associate this language with any other INI-like formats as well if you notice it fits better.

#### Embedded Code
Syntax-coloring of valid embedded code is supported.
- **GDAsset**: in asset strings for GDScript and GDShader resources.  
	😎 It even handles both inner and outer languages' escape sequences gracefully, and colors them differently:  
	![Showcasing how embedded code escape sequences are handled gracefully](docs/showcase-embedded-code-escapes.webp)
- **GDShader**: in `codeblock`-type BBCode tags in documentation comments (including `[gdscript]` and `[csharp]` tags).  
	Note that you should always put the inner code in its own lines verbatim, without the leading `*`, or any extra leading indentation.  
	![Showcasing how you should embed code in GDShader docs BBCode](docs/showcase-gdshader-docs-embed-code.webp)

The inner code doesn't break the container code syntax, as long as it's valid code (without partial contructs like unterminated strings/comments, mismatched brackets, etc). Some cases are being handled, but it's not viable to try to safeguard against every possible case of invalid code; this is a limitation of the IDE.

### Document Symbols
Symbol definitions are provided for:
- 🔒 **GDShader** files (only in [early access][donate], see below).
- **GDAsset** files, as per their INI-like structure.
- **Configuration Properties** (non-Godot INI-like) files.

The IDE uses this in many places, like the **Outline** view, in **Breadcrumbs** and in the "**Go to Symbol in Editor**" feature (typing `@` in the command palette).

### Features in GDAsset files
These features are supported in textual Scene and Resource files.

- **Navigate to the definition** of `SubResource` and `ExtResource` references, and to resource paths.  
	![Showcasing navigate to definition](docs/showcase-goto-definition.png)  
	Going to the definition of a built-in engine type (on `type="SomeType"` or `some_field = SomeType(...)`) will open its Godot API Documentation. This will be handled by the *godot-tools* extension, unless you're online and enabled [early access][donate] (see below).

- **See GDScript code for loading** a resource reference or path by hovering (`preload(…)`, `load(…)` or `FileAccess.open(…)`).  
	![Showcasing code for loading when previewing user path](docs/showcase-user-path-load.webp)

- **Preview images and fonts** by hovering their resource paths or `ExtResource` references.  
	🔧 You can disable resource previews when hovering with the setting `godotFiles.hover.previewResource`.  
	💻 On browser IDEs, this may only work for small files (approx. 74kB or less).
	
	![Showcasing image preview](docs/showcase-image-preview.png)  
	✳️ Images supported: SVG, PNG, WebP, JPEG, BMP, GIF.
	
	The font preview shows all uppercase and lowercase ASCII letters and helps testing if they're too similar to numbers:  
	![Showcasing font preview](docs/showcase-font-preview.webp)  
	✳️ Fonts supported: TTF, OTF, WOFF, WOFF2.

- **Preview the thumbnail of a resource file** as generated by the Godot Editor by hovering its external reference.  
	Godot doesn't need to be running because it updates thumbnail files into the cache whenever a resource is saved.  
	🔧 The setting `godotFiles.hover.previewResource` also applies here.  
	💻 This feature is not available on browser IDEs, as it depends on the thumbnail cache that Godot writes on your PC.  
	⚠️ If you're using Godot in [self-contained mode](https://docs.godotengine.org/en/stable/tutorials/io/data_paths.html#self-contained-mode), this requires adding the cache path with the setting `godotFiles.godotCachePath`.
	
	It works for scenes:  
	![Showcasing thumbnail preview of a scene](docs/showcase-scene-thumb.webp)
	
	As well as any other resource files that have a thumbnail in Godot Editor:  
	![Showcasing thumbnail preview of a material resource](docs/showcase-material-thumb.webp)

- **Edit a color by hovering its inline decorator** on `Color(…)` values or within an array. You can also see its hex value.  
	🔧 You can disable this feature with the settings under `godotFiles.inlineColors` (`.single` and `.array`).  
	![Showcasing inline color decorators](docs/showcase-color-decorators.webp)  
	✳️ The displayed color (and its hex value) can't consider advanced cases like HDR and color space changes (e.g. between sRGB and linear).

#### Latest feature no longer restricted
🌟 This is now out of early access:

- **See implied parentheses in packed arrays** of vectors or colors that surround items, similar to inlay hints.  
	🔧 You can toggle this feature with the settings under `godotFiles.clarifyArrays` (`.vector` and `.color`).  
	✳️ This feature respects `editor.maxTokenizationLineLength` to avoid potential performance issues on very long lines.  
	![Showcasing implied parentheses in array items as inlay hints](docs/showcase-parentheses-hint-in-arrays.webp)

If you want **more features**, check the sections **Early Access**, **Crowdfunding** and **Potential Future Development** below.

## Early Access

Features in early access are ready for use, but **restricted to supporters** at first.  
Each feature will stay restricted until the next new feature takes its place in a future version, usually months later.

🔑 To unlock all features as soon as they arrive, please [donate] and copy the password, then use the ***Unlock features in early access*** command (right-click this extension in the Extensions panel) and paste it in the prompt. Doing this **just once will permanently unlock** everything in early access, even across updates.

The features below are currently restricted.

### Godot Documentation Viewer
Browse the online Godot Documentation directly from the IDE.  
⚙️ You can use the command ***Godot Files: Open Godot API Documentation*** to show the page listing all classes.  
🔧 The setting `godotFiles.documentation.viewer` lets you choose your preferred viewer for when you're online:
- `godot-tools`: Use the *godot-tools* extension to open API docs (offline; requires Godot to be running and connected).
- 🔒 `browser`: Open online documentation URLs in the external browser. Also supports going to the specific Godot version.
- 🔒 `webview`: Load online documentation pages internally within IDE tabs (including tutorials).  
Searches and external links are opened in your browser. This advanced viewer supports redirecting inherited members to locate their definition in a parent class. There's a few settings for it too. Some features (e.g. translations, user-contributed notes) are not supported in this viewer, but you can use the command to open the page externally.

![Showcasing a Godot Docs tutorial page on the internal webview](docs/showcase-docs-webview-tutorial.webp)

### GDShader Language Features
After a huge effort, basic support for GDShader language features is finally available! 🎉  
It's completely independent from Godot Editor and **doesn't require Godot to be running** or even available, so it works on browser IDEs too.

🔧 The setting `godotFiles.shader.analysisLevel` can be used to restrict how far the analysis goes, which affects all of these features.
- 🔒 Standalone **GDShader Preprocessor** for IDEs.
	- 🔒 Preprocessor error diagnostics (squiggles).
	- 🔒 Preprocessor symbol definitions in outline and breadcrumbs.
	- 🔒 Preprocessor marking inactive `#if…#endif` regions with less opacity.  
	🔧 The setting `godotFiles.inactiveRegionOpacity` changes the transparency of the inactive regions.
- 🔒 **GDShader Lexer**, using ANTLR4.
	- 🔒 Lexical error diagnostics (squiggles).
- 🔒 **GDShader Parser**, using ANTLR4.
	- 🔒 Syntactical error diagnostics (squiggles).
	- 🔒 Syntactical symbol definitions in outline and breadcrumbs.

Note that you will only get error squiggles for the checks above, as analyzers for **semantic errors are not implemented yet** (so no type errors, name errors, control flow errors, usage errors, etc). This means files that show no errors here can still raise errors in the Godot Editor. This work is only the beginning.

The preprocessor produces sourcemapping for all ranges within `#include` and macro expansions, so e.g. errors from an included file refer to the actual source.

![Showcasing how GDShader preprocessor can sourcemap errors back to the included file](docs/showcase-gdshader-srcmap-error.png)

## Crowdfunding

This extension is free, but making it is not free at all. Development of features took a huge amount of work (specially of GDShader language features in particular). This should be only the start, but it's **not possible to make any further progress** in this extension due to the extremely low amount of [donations][donate] 📉. Yet I really want this extension to stay free in public domain, with no ads. So I have no choice - I have to request a bit of crowdfunding, to see whether this project can continue at all or has to be abandoned 😢.

A [**collective donation goal**][donate] was set, to compensate the amount of work (commits, days) **already done** to implement the features.  
**If the goal is not reached by the community within the time limit, then the project has to be abandoned**.

By donating, you make development possible, helping yourself and everyone else at the same time, so please do if you have the means to, specially if you want proper GDShader support in VSCode or any other features listed in the **Potential Future Development** section below.

## Special Thanks
❤️ Huge thanks to everyone who has donated so far! There's now donation tiers to also [get your logo or GitHub user listed][donate] right here.

[![Logo 00](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-00.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-00.html)
[![Logo 01](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-01.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-01.html)
[![Logo 02](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-02.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-02.html)
[![Logo 03](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-03.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-03.html)
[![Logo 04](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-04.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-04.html)
[![Logo 05](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-05.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/logo-05.html)

[![User 00](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-00.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-00.html)
[![User 01](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-01.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-01.html)
[![User 02](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-02.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-02.html)
[![User 03](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-03.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-03.html)
[![User 04](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-04.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-04.html)
[![User 05](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-05.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-05.html)
[![User 06](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-06.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-06.html)
[![User 07](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-07.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-07.html)
[![User 08](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-08.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-08.html)
[![User 09](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-09.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-09.html)
[![User 10](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-10.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-10.html)
[![User 11](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-11.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-11.html)
[![User 12](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-12.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-12.html)
[![User 13](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-13.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-13.html)
[![User 14](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-14.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-14.html)
[![User 15](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-15.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-15.html)
[![User 16](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-16.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-16.html)
[![User 17](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-17.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-17.html)
[![User 18](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-18.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-18.html)
[![User 19](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-19.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-19.html)
[![User 20](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-20.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-20.html)
[![User 21](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-21.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-21.html)
[![User 22](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-22.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-22.html)
[![User 23](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-23.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-23.html)
[![User 24](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-24.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-24.html)
[![User 25](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-25.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-25.html)
[![User 26](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-26.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-26.html)
[![User 27](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-27.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-27.html)
[![User 28](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-28.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-28.html)
[![User 29](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-29.png)](https://alfish.bitbucket.io/VSCode/godot-files/sponsor/user-29.html)

## Support

This software is free and in the [public domain]. It respects your privacy by not collecting any data.  
👍 If you think this is useful, please star the [GitHub repo] and give it a rating on [VS Marketplace] or [Open-VSX].  
🛒 [Itch Store] | [ArtStation] | [Unity Assets]  
🌐 [GitHub] | [Bitbucket] | [Reddit] | [YouTube]

[donate]: https://alfish.itch.io/godot-files-vscode
[public domain]: https://unlicense.org/
[GitHub repo]: https://github.com/AlfishSoftware/godot-files-vscode
[VS Marketplace]: https://marketplace.visualstudio.com/items?itemName=alfish.godot-files
[Open-VSX]: https://open-vsx.org/extension/alfish/godot-files
[Itch Store]: https://alfish.itch.io/
[ArtStation]: https://www.artstation.com/a/26333626
[Unity Assets]: https://assetstore.unity.com/publishers/30331
[GitHub]: https://github.com/AlfishSoftware
[Bitbucket]: https://bitbucket.org/alfish/workspace/repositories
[Reddit]: https://www.reddit.com/user/AlfishSoftware/
[YouTube]: https://www.youtube.com/channel/UCMaO6Qb1IcyEBo7AcMlQ78g

## Third-party Notices

When accessing 3rd-party websites, you may be subject to their privacy policies.  
Also, content may be automatically fetched from GitHub and Godot websites, as necessary.

Content from **Godot** is available under the licenses found in their repositories for [code/API](https://github.com/godotengine/godot) and for [documentation](https://github.com/godotengine/godot-docs).

The included [**ANTLR4 Runtime Library**](https://www.npmjs.com/package/antlr4) is distributed under the **BSD-3-Clause** license, found in [their repository](https://github.com/antlr/antlr4).

## Known Minor Limitations

Some commands like the buttons in the Godot Docs webview might not work consistently when using aux / floating windows or dragging tabs to different tab groups.

Parsing of INI-like files is very simplistic (line-based; doesn't use a robust parser library), but should work well for almost all cases where files were generated by Godot. A few corner cases might not match, specially if you manually edit files (e.g., a line with an array value like `[null]` may be interpreted as a section). Also, `ext_resource` paths containing comment chars (`#` or `;`) are not parsed properly in outline; this causes issues in hover too.

VSCode only recognizes a word token properly when hovering or placing the cursor within its first 32 characters. So, for long paths, you only get the tooltip when hovering this initial part of the path.

---

## Potential Future Development

The features below are theoretically feasible (if the project isn't abandoned).  
Each $ means about a week of work needed to implement it. These are very rough estimates, and this list may change.

### Textual GDAsset

Id | Weeks | Possible Feature
-|-|-
aArrayCount | $ | Show array size and element indices
aHoverCartesian | $$$$$ | Cartesian hover previews for some coordinate values like vector, quat, basis, etc

### Binary Godot Asset

Id | Weeks | Possible Feature
-|-|-
bDecode | $$ | Read-only textual GDAsset code (tres, tscn) for binary resource files (res, scn, etc.)
bTexView | $$ | Open .stex and .ctex texture files like images

### GDShader

Id | Depends on | Weeks | Possible Feature
-|-|-|-
sProjSymbol | ~~sParser~~ | $ | Go to Workspace Symbol
sGotoDef | ~~sParser~~ | $ | Go to Definition in User Code
sHighlight | sGotoDef | $ | Highlight Occurrences
sLangCompl | ~~sParser~~ | $ | Basic Completions (Keywords, Snippets)
sUserDocs | ~~sParser~~ | $$ | User API Documentation
sUserCompl | ~~sParser~~ | $$ | User API Completions
sUserSign | ~~sParser~~ | $$ | User API Signature Help
sCoreApi | sUserDocs | $$$ | Structured Built-in API + Docs (fetch online)
sGotoDocs | sCoreApi, ~~sParser~~ | $ | Go to Online Documentation
sFindRef | sCoreApi, sHighlight | $ | Find References
sRename | sCoreApi, sFindRef | $ | Rename Refactoring
sCoreDocs | sCoreApi, ~~sParser~~ | $$$ | Built-in API Documentation
sCoreCompl | sCoreApi, ~~sParser~~ | $$$ | Built-in API Completions
sCoreSign | sCoreApi, ~~sParser~~ | $$$ | Built-in API Signature Help
sSemColor | sCoreApi, ~~sSyntaxErr~~ | $ | Semantic Coloring
sSemErr | sSemColor | $$$$ | Report Some Semantic Errors

<!-- No plans for: sFixErr, sCodeLens, sColor, sFormatFile, sFormatSel, sFormatAuto -->

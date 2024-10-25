# Changelog
<!-- Types of changes: Security, Removed, Deprecated, Changed, Added, Fixed -->

Features currently in early access are marked with 🔒 as they're restricted to [supporters].  
Features previously in early access are marked with ***vX.Y.Z*** 🔓 as they're unlocked for everyone since that version.

## [Unreleased]
### Added
- GDAsset: Show engine classes as inlay hints on `ExtResource(…)` and `SubResource(…)` references.
- GDAsset: Show file paths as inlay hints on `ExtResource(…)` references.
- GDShader: Add `#error` directive to preprocessor and to syntax coloring.
- Docs: Add text content provider for doc URI, so it shows the webpage URL when peeking a class/member definition.
### Fixed
- Stronger pattern to match files with more priority than other extensions like godot-tools.
- GDAsset: Use `$"../etc"` instead of `$"/root/etc"` in the outline, as scenes are not always under root.

## [0.1.0] - 2024-10-16
### Changed
- GDShader: Disable url detection by default, since in BBCode it incorrectly includes the `[/url]` end tag too.
### Added
- 🔒 GDShader: Standalone preprocessor for IDEs, with sourcemapping for ranges within `#include` and macro expansions.
- 🔒 GDShader: Preprocessor error diagnostics.
- 🔒 GDShader: Preprocessor symbol definitions in outline and breadcrumbs.
- 🔒 GDShader: Preprocessor marking inactive `#if…#endif` regions with less opacity.
- 🔒 GDShader: Lexer and parser with ANTLR4 grammars, also independent from Godot Editor.
- 🔒 GDShader: Lexical and syntactical error diagnostics.
- 🔒 GDShader: Syntactical symbol definitions in outline and breadcrumbs.
- GDShader: Add syntax coloring for documentation comment blocks and BBCode tags, including embedded code support.
- GDShader: Add `hint_enum` and `samplerExternalOES` type keyword to syntax coloring.
- Docs Webview: Add links to `stable` and `latest` versions, since it no longer supports the panel below the sidebar.
### Fixed
- GDAsset: Fix issue of embedded languages not being recognized for toggling comments and snippets.
- GDAsset: Fix outline symbol detail to prioritize `instance` and `instance_placeholder` over `index`.
- GDShader: Fix syntax coloring for concatenation token, macro parameter commas and numbers starting with a point.
- Fix potential null-safety bugs from out-of-bounds indexing by using stricter checks.

## [0.0.10] - 2024-07-30
### Changed
- Docs: Use a simpler URI in IDE tabs.  
	Please close any webview documentation tabs that were already open from v0.0.8 ~ v0.0.9 (tabs with wrong icon).
### Added
- Docs Webview: Setting to allow disabling redirection of missing members to base class page.
### Fixed
- GDAsset: Fix godot-tools grammar breakage on embedded GDScript containing `{...}` or `[...]`.
- GDAsset: Support resource references as type parameters, for typed arrays of script types.
- GDAsset: Support `Resource("res://path")` syntax.
- GDAsset: Fix `type="..."` word matching when going to definition.
- GDAsset: Color the type in a resource's `script_class="T"` like a type.
- GDAsset: Distinguish types for syntax coloring (basic, engine, user).
- Docs: "Open API docs" command also uses `godot-tools` fallback (list classes) when preferred or when offline.
- Docs Webview: Always disable redirection of members to base class page when at a past navigation history point.
- Docs Webview: Show a page with message and link on network errors like connection timeout and HTTP errors like 404.
- Docs Webview: Workaround for unreliable history when dragging tabs to other groups.

## [0.0.9] - 2024-06-13
### Changed
- Docs Webview: Join "Open in External Browser" button under reload button, shown when <kbd>Alt</kbd> is held.
### Added
- Docs Webview: Back and forward navigation history buttons.
- Docs Webview: Detect if project has .NET feature and use C# as default code language tab in this case.
- Docs: Keybinding to open Godot API docs (<kbd>Ctrl</kbd> <kbd>F1</kbd> | <kbd>⌥</kbd> <kbd>⌘</kbd> <kbd>D</kbd>).
### Fixed
- GDAsset: Support asset format v4, with parentheses inlay hints for `PackedVector4Array`.
- Docs Webview: Fix page titles with invalid characters like `/` `#` `?`.
- Docs Webview: Fix navigation to links added dynamically and hide latest-to-stable links which don't work.
- Docs Webview: Fix styling more reliably on older versions.
- Docs Webview: Inject text with link explaining that user-contributed notes can't be loaded on webview.

## [0.0.8] - 2024-04-30
### Changed
- Setting `godotFiles.godotCachePath` variable substitution is now compatible with vscode syntax.  
	⚠️ **Attention**:  
	If you had manually set this, make sure to update the setting.  
	Note that syntaxes `${VAR}` and `%VAR%` are no longer valid, use `${env:VAR}` instead.
- Using `config-definition` language (same advanced grammar as GDAsset) by default for Git config files.
### Added
- GDAsset: Open docs when going to definition of a built-in type in GDAsset.
- Docs: Command to open Godot API docs listing all classes.
- Docs: Add a viewer which delegates documentation handling to the `godot-tools` extension via `gddoc:` URI.
- 🔒 Docs: Add a simple `browser` viewer, which opens the online docs URL in the external browser.
- 🔒 Docs: Add an advanced `webview` viewer, which loads the online docs internally within tabs in the IDE.
### Fixed
- Fix GDAsset quotes escaping on embedded GDScript for new grammar (from godot-tools v2) and raw/triple-quoted strings.
- Add the cache paths of flatpak Godot3 and Godot3Sharp to the defaults for `godotCachePath` setting.
- Fix checking for `file:` URI scheme on project detection and resource thumbnails.
- Web: Fix resource thumbnails issue in web IDE.
- Web: Allow unlocking early access on web IDE too.

## [0.0.7] - 2023-11-25
### Fixed
- Add the `org.godotengine.GodotSharp` flatpak cache path to the defaults for `godotCachePath` setting.
- GDAsset: Fix filetype detection from the first line for Godot 4+ (e.g. in untitled files, which have no extension).
- Improve `.tscn` file icon colors to better match Godot's XYZ axes' colors.

## [0.0.6] - 2023-10-02
### Added
- ***v0.0.8*** 🔓 GDAsset: Inline color decorators on `Color(…)` values and within arrays.
- ***v0.1.0*** 🔓 GDAsset: Inlay hints surrounding items with implied parentheses in packed arrays of vectors or colors.
### Fixed
- GDAsset: Add `.woff2` as a supported font preview format.

## [0.0.5] - 2023-08-21
### Changed
- GDAsset: Better outline names like GDScript syntax for nodes and connections.
### Added
- GDShader: Allow uint suffix on hex literals.
- GDShader: Syntax-coloring for preprocessor token concatenation `##` symbol (colored like a comment).
- GDAsset: Recognize `.tet` (Godot Text Editor Theme) filetype as `godot-asset`.
- GDAsset: Outline recognizes `editable` tag and `instance(_placeholder)` node attributes in scene.
### Fixed
- GDAsset: Fix hover/goto-def infinite loop on untitled files (stuck on "loading...").
- GDAsset: Fix goto definition when cursor is on string argument of Ext/Sub Resource("id").
- GDAsset: Fix partial `ext_resource` path hover at end of string being incorrectly accepted.
- GDAsset: Fix duplicate preload code when hovering path to the file itself.
- GDAsset: Tolerate `*` before resource path (for `[autoload]`).

## [0.0.4] - 2023-06-22
### Added
- Command to unlock features in early access. Running it again shows "disable" option.
- ***v0.0.6*** 🔓 GDAsset: Hover any resource to preview its thumbnail, as generated by Godot Editor.
- GDAsset: Setting `godotFiles.hover.previewResource` can be used to disable link and image preview when hovering.
- GDAsset: Hovering uid path shows `preload(…)` code.
- GDAsset: Hovering non-res paths like file and user schemes shows `FileAccess.open(…)` code.
- GDAsset: Recognize `.remap` filetype as `godot-asset`.
### Fixed
- GDAsset: Hovering Ext/Sub Resource calls should also work when mouse is over the string argument.
- GDAsset: Fix relative path detection on `ext_resource` for Godot 4.

## [0.0.3] - 2023-05-16
### Changed
- New icon, optimized for 24px and 42px display in IDE.
- Using The Unlicense, which more explicitly says this is public domain.
### Added
- GDShader: Support Godot 4.0 syntax (preprocessor syntax, new hints, new keywords) and gdshaderinc files.
- GDAsset: Recognize GDScript and GDShader syntax in inline strings in any asset (even in code-as-tres files).
- Allow declarative features like syntax coloring on untrusted workspaces.
- Can now function as a Web Extension too.
- Readme: Screenshot, donation link and table of possible features.
### Fixed
- GDShader: Add missing operators and make operator syntax more specific.
- GDAsset: Fix syntax for generic types like `Array[Dictionary]` and multiline sections.
- GDAsset: Improvements on sub res paths (hover and go to definition).
- GDAsset: Improve image/font hover of small files, avoiding rendering cache.
- GDAsset: Fix empty initial hover because of lag, by not requiring gdscript.

## [0.0.2] - 2022-06-22
### Fixed
- GDAsset: Font previews of larger files were broken.
- GDAsset: Paths now work regardless of which workspace is open in the IDE.

## [0.0.1] - 2022-06-08
### Added
- Syntax coloring for GDShader files.
- Syntax coloring for Asset (INI-like) files.
- Document structure for Asset (INI-like) files.
- GDAsset: Navigation to definition of resource references and paths.
- GDAsset: Image and font previews by hovering references and paths.
- GDAsset: Hover resource references to show GDScript preload code.

[Unreleased]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.1.0...develop
[0.1.0]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.10...v0.1.0
[0.0.10]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/AlfishSoftware/godot-files-vscode/compare/2301cc35...v0.0.1
[supporters]: https://alfish.itch.io/godot-files-vscode

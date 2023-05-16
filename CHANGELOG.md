# Changelog
<!-- Types of changes: Security, Removed, Deprecated, Changed, Added, Fixed -->

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

[Unreleased]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.3...develop
[0.0.3]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/AlfishSoftware/godot-files-vscode/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/AlfishSoftware/godot-files-vscode/compare/2301cc35...v0.0.1

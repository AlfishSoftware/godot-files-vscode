# Changelog
<!-- Types of changes: Security, Removed, Deprecated, Changed, Added, Fixed -->

## [0.0.3] - 2023-04-06
### Changed
- Using The Unlicense, which more explicitly says this is public domain.
### Added
- GDShader: Support Godot 4.0 syntax (preprocessor syntax, new hints, new keywords) and gdshaderinc files.
- GDAsset: Recognize GDScript and GDShader syntax in inline strings in any asset (even in code-as-tres files).
### Fixed
- GDShader: Add missing operators and make operator syntax more specific.

## [0.0.2] - 2022-06-22
### Fixed
- GDAsset font previews of larger files were broken.
- Paths in GDAsset files now work regardless of which workspace is open in the IDE.

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
[0.0.1]: https://github.com/AlfishSoftware/godot-files-vscode/compare/c26648ce...v0.0.1

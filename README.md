# Godot Files

Provides syntax-highlighting for some Godot Editor files.

This isn't meant to replace the [godot-tools] extension, but it has improvements on its supported files.

## Features

Includes syntax-highlighting for these languages:
- Godot Shader files: `.gdshader`, `.gdshaderinc`
- Better (more specific) grammar for the INI-like files supported by Godot (Asset Properties Definition):  
  `.godot`, `.tscn`, `.escn`, `.tres`, `.gdns`, `.gdnlib`, `.import`, etc.
- The same grammar is reused for `.cfg` and the INI-like XDG Desktop Entry files: `.desktop`, `.directory`  
  You might want to associate this language (Configuration Properties) with other INI-like formats as well.

INI-like files also support:
- outline and breadcrumb items

INI-like Godot asset files also support:
- navigate to definition of Ext/Sub Resource references, and to resource paths
- hover image and font resource paths/references to preview them (only some formats are supported)
- hover resource references to show gdscript (pre)load code

Other features such as full hover documentation, etc., *might* be included eventually, but aren't as of now.

## Known Limitations

Parsing of INI-like files is very simplistic (line-based; doesn't use a robust parser library), but should work well.

Embedded code (like gdscript/gdshader) in asset strings is syntax-highlighted, however:
- VSCode is not recognizing "embeddedLanguages" properly for some reason (bug?), so things like toggling comments,
  snippets, etc. won't consider the embedded language's context

Target is mostly Godot 3 for now (some Godot 4 features are supported, but not actively tested).

## Support

❤️ If you think this is useful, please check [alfish.itch.io].

[godot-tools]: https://github.com/godotengine/godot-vscode-plugin
[alfish.itch.io]: https://alfish.itch.io/

// Lexer for *.gdshader and *.gdshaderinc files.

lexer grammar GDShaderLexer;
channels { DOCUMENTATION }

COMMENT_BLOCK: '/*' .*? ('*/'|EOF) -> channel(HIDDEN); //TODO detect documentation, unterminated
COMMENT_LINE: '//' ~[\n\r]* -> channel(HIDDEN);
PRAGMA: '#pragma' ~[\n\r]* -> channel(HIDDEN); // ignore unrecognized pragmas that may come from preprocessor
WHITESPACE: [ \t\n\r]+ -> channel(HIDDEN);

STRING
: '"' ( '\\' ["\\] | ~[\\"\n\r] )* '"'
| '"' ( '\\' . | ~[\\"] )* '"' {false}?; // fallback allows invalid chars|escapes to not break token
FLOAT: (DIGITS EXPONENT | (DIGITS? '.' DIGITS | DIGITS '.') EXPONENT?) [fF]?;
HEX: '0' [xX] [0-9A-Fa-f]+ [uU]?;
INTEGER: DIGITS [uU]?;
BOOL: 'false' | 'true';

OP_ITERATIVE: '++' | '--';
OP_COMPOUND_ASSIGNMENT: ([-+*/%] '=') | ('<<=' | '>>=') | ([&^|] '=');
OP_EQUALITY: '==' | '!=';
OP_SHIFT: '<<' | '>>';
OP_RELATIONAL: [<>] '='?;
OP_LOGICAL_NOT: '!';
OP_LOGICAL_AND: '&&';
OP_LOGICAL_OR: '||';
OP_MINUS: '-';
OP_PLUS: '+';
OP_MULTIPLICATION: '*';
OP_DIVISIVE: [/%];
OP_BITWISE_NOT: '~';
OP_BITWISE_AND: '&';
OP_BITWISE_XOR: '^';
OP_BITWISE_OR: '|';

EQUAL: '=';
QUESTION: '?';
COLON: ':';
DOT: '.';
COMMA: ',';
SEMICOLON: ';';

PARENTHESIS_L: '(';
PARENTHESIS_R: ')';
BRACKET_L: '[';
BRACKET_R: ']';
BRACE_L: '{';
BRACE_R: '}';

KEYWORD_SHADER_TYPE: 'shader_type';
KEYWORD_CLASSIFIER: 'render_mode';
KEYWORD_SCOPING: 'group_uniforms';

KEYWORD_STRUCT: 'struct';

KEYWORD_CONTROL_IF: 'if';
KEYWORD_CONTROL_ELSE: 'else';
KEYWORD_CONTROL_DO: 'do';
KEYWORD_CONTROL_WHILE: 'while';
KEYWORD_CONTROL_FOR: 'for';
KEYWORD_CONTROL_SWITCH: 'switch';
KEYWORD_CONTROL_CASE: 'case';
KEYWORD_CONTROL_DEFAULT: 'default';

KEYWORD_RETURN: 'return';
KEYWORD_JUMP: 'discard' | 'break' | 'continue';

KEYWORD_QUALIFIER_OUT: 'out';
KEYWORD_QUALIFIER_INOUT: 'inout';
KEYWORD_QUALIFIER_IN: 'in';
KEYWORD_MODIFIER_CONST: 'const';
KEYWORD_MODIFIER_VARYING: 'varying';
KEYWORD_INTERPOLATOR: 'flat' | 'smooth';
KEYWORD_MODIFIER_UNIFORM: 'uniform';
KEYWORD_SHARING: 'global' | 'instance';

KEYWORD_TYPE_VOID: 'void';

KEYWORD_TYPE_BOOLEAN: 'bool' | 'bvec' [234];

KEYWORD_PRECISION: ('low' | 'medium' | 'high') 'p';
KEYWORD_TYPE_NUMERIC
: 'u'? 'int' | 'float'
| [iu]? 'vec' [234] | 'mat' [234]
;
KEYWORD_TYPE_SAMPLER: [iu]? 'sampler' ('2D' 'Array'? | '3D') | 'samplerCube' 'Array'?;

KEYWORD_HINT_SIMPLE
: 'source_color'
| 'hint_'
	( 'color' | 'black_'? 'albedo' | 'normal'
	| 'default_'? ('white' | 'black')
	| 'default_transparent'
	| 'aniso' 'tropy'?
	| 'roughness_' ([rgba] | 'normal' | 'gray')
	| ('screen' | 'depth' | 'normal_roughness') '_texture'
	)
| 'filter_' ('nearest' | 'linear') ('_mipmap' '_anisotropic'?)?
| 'repeat_' ('en' | 'dis') 'able'
| 'instance_index'
;
KEYWORD_HINT_RANGE: 'hint_range';
KEYWORD_HINT_ENUM: 'hint_enum';

ID: [a-zA-Z_] [a-zA-Z0-9_]*;

fragment DIGITS: [0-9]+;
fragment EXPONENT: [eE] [-+]? DIGITS;

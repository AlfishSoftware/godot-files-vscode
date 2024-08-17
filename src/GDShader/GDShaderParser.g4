// Parser for *.gdshader and *.gdshaderinc files.

parser grammar GDShaderParser;
options { tokenVocab = GDShaderLexer; }

aShaderCode: aShaderType? defs+=aRootDef* EOF;
aShaderType: 'shader_type' value=ID ';';
aRootDef
: aRenderMode
| aGroupUniforms
| aStructDef
| aFunctionDef
| aConstDef ';'
| aVaryingDef ';'
| aUniformDef ';'
;

aAtomicAnyType: aAtomicIntrinsicType | aAtomicNamedType;
aAtomicConstructibleType: aAtomicBasicType | aAtomicNamedType;
aAtomicIntrinsicType: aAtomicBasicType | aAtomicSamplerType;
aAtomicSamplerType: precision=KEYWORD_PRECISION? typeWord=KEYWORD_TYPE_SAMPLER;
aAtomicBasicType
: precision=KEYWORD_PRECISION? typeWord=KEYWORD_TYPE_NUMERIC
| typeWord=KEYWORD_TYPE_BOOLEAN
;
aAtomicNamedType: typeName=ID;
aArraySize: '[' size=aExpression? ']';

aRenderMode: 'render_mode' values+=ID (',' values+=ID)* ';';

aGroupUniforms: 'group_uniforms' (group=ID ('.' subgroup=ID)?)? ';';

aStructDef: 'struct' name=ID '{' fieldDefs+=aStructFieldDef+ '}' ';';
aStructFieldDef
: aAtomicConstructibleType
	( aArraySize names+=ID (',' names+=ID)*
	| flexileNames+=aFlexileName (',' flexileNames+=aFlexileName)*
	) ';'
;
aFlexileName: name=ID aArraySize?;

aFunctionDef: aReturnType name=ID '(' (parameters+=aParameterDef ',')* parameters+=aParameterDef? ')' aBlock;
aReturnType: 'void' | aAtomicConstructibleType aArraySize?;
aParameterDef: aDirectionalQualifier aAtomicAnyType (aArraySize name=ID | name=ID aArraySize?);
aDirectionalQualifier: qualifier='out' | qualifier='inout' | qualifier='const' 'in'? | 'in'?;

aConstDef
: 'const' aAtomicConstructibleType
	( aArraySize names+=aNameInit (',' names+=aNameInit)*
	| flexileNames+=aFlexileNameInit (',' flexileNames+=aFlexileNameInit)*
	)
;
aNameInit: name=ID '=' value=aExpression;
aFlexileNameInit: name=ID aArraySize? '=' value=aExpression;

aVaryingDef: 'varying' interpolator=KEYWORD_INTERPOLATOR? aAtomicBasicType (aArraySize name=ID | name=ID aArraySize?);

aUniformDef: sharing=KEYWORD_SHARING? 'uniform' aAtomicIntrinsicType (aArraySize name=ID | name=ID aArraySize?)
	(':' typeHints+=aTypeHint (',' typeHints+=aTypeHint)*)? ('=' value=aExpression)?
;
aTypeHint
: hint=KEYWORD_HINT_SIMPLE
| hint='hint_range' '(' min=aLiteralNumber ',' max=aLiteralNumber (',' step=aLiteralNumber)? ')'
| hint='hint_enum' '(' (choices+=STRING ',')* choices+=STRING ')'
;
aLiteralNumber: sign='-'? absolute=(FLOAT | INTEGER) | absolute=HEX;

aScope: aStatement; // weirdly allows a single aVarDef too, unlike other languages

aBlock: '{' statements+=aStatement* '}';
aStatement
: aBlock
| ';'
| aJumpStatement ';'
| aConditionalStatement
| aSwitchStatement
| aForStatement
| aWhileStatement
| aRepeatStatement ';'
| aConstDef ';'
| aLocalVarDef ';'
| aExpression ';'
;

aLocalVarDef
: aAtomicConstructibleType
	( aArraySize names+=aNameDef (',' names+=aNameDef)*
	| flexileNames+=aFlexileNameDef (',' flexileNames+=aFlexileNameDef)*
	)
;
aNameDef: name=ID ('=' value=aExpression)?;
aFlexileNameDef: name=ID aArraySize? ('=' value=aExpression)?;

aJumpStatement: instruction='return' value=aExpression? | instruction=KEYWORD_JUMP;

aConditionalStatement: 'if' '(' condition=aExpression ')' thenScope=aScope ('else' elseScope=aScope)?;
aRepeatStatement: 'do' aScope 'while' '(' condition=aExpression ')';
aWhileStatement: 'while' '(' condition=aExpression ')' aScope;
aForStatement: 'for' '(' vars=aLocalVarDef? ';' condition=aExpressions ';' continuation=aExpressions ')' aScope;
aSwitchStatement: 'switch' '(' condition=aExpression ')' '{' cases+=aCaseScope+ '}';
aCaseScope: ('case' value=aExpression | 'default') ':' statements+=aStatement*;

aExpressions: ((expressions+=aExpression ',')* expressions+=aExpression)?;

aDelimitedExpression
: '(' aExpression ')'
| aNamedCall
| aAtomicBasicConstructor
| aArrayConstructor
| aLiteral
| aNominal
;
aNamedCall: callableName=ID '(' args=aExpressions ')'; // named function or named constructor
aAtomicBasicConstructor: aAtomicBasicType '(' args=aExpressions ')';
aArrayConstructor: '{' values=aExpressions '}' | aAtomicConstructibleType aArraySize '(' values=aExpressions ')';
aLiteral: FLOAT | INTEGER | HEX | BOOL;
aNominal: name=ID;

aPostfixedExpression
: aDelimitedExpression
| a=aPostfixedExpression '[' index=aExpression ']' iterating=OP_ITERATIVE? // Indexed Access
| a=aPostfixedExpression '.' method=aNamedCall // Method Call
| a=aPostfixedExpression '.' propertyName=ID iterating=OP_ITERATIVE? // Property Access
| aNominal iterating=OP_ITERATIVE // Variable Access
;
aAddressable
: a=aPostfixedExpression '[' index=aExpression ']' // Indexed Address
| a=aPostfixedExpression '.' propertyName=ID // Property Address
| aNominal // Variable Address
;
aPrefixedExpression
: aPostfixedExpression
| op=OP_ITERATIVE address=aAddressable // Iteration
| op=('-'|'+'|'!'|'~') a=aPrefixedExpression // Polarization
;
aInfixedExpression
: aPrefixedExpression
| a=aInfixedExpression op=('*'|OP_DIVISIVE) b=aInfixedExpression // Monomial
| a=aInfixedExpression op=('-'|'+') b=aInfixedExpression // Polynomial
| a=aInfixedExpression op=OP_SHIFT b=aInfixedExpression // Scaling
| a=aInfixedExpression op=OP_RELATIONAL b=aInfixedExpression // Assessment
| a=aInfixedExpression op=OP_EQUALITY b=aInfixedExpression // Identification
| a=aInfixedExpression op='&' b=aInfixedExpression // Intersection
| a=aInfixedExpression op='^' b=aInfixedExpression // Distinction
| a=aInfixedExpression op='|' b=aInfixedExpression // Union
| a=aInfixedExpression op='&&' b=aInfixedExpression // Necessity
| a=aInfixedExpression op='||' b=aInfixedExpression // Sufficiency
| a=aInfixedExpression op='?' thenValue=aExpression ':' elseValue=aExpression // Conditional
;

aExpression
: aInfixedExpression
| address=aAddressable op=('='|OP_COMPOUND_ASSIGNMENT) value=aExpression // Assignment
;




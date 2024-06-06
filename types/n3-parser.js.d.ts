declare module 'n3-parser.js' {

  export type LexerTokenMap = {
    BLANK_TRIPLE_DATA: LexerToken[], // property list
    BOOLEAN_LITERAL: `${'@'|''}true` | `${'@'|''}false`, // [ prefix, uri ]
    DOCUMENT: LexerToken[], // statements
    EXISTENTIAL: LexerToken[],
    EXPLICIT_IRI: string,
    FORMULA: LexerToken[], // statements
    LIST: LexerToken[],
    NUMERIC_LITERAL: string,
    PREDICATE_OBJECT: [ LexerToken, LexerToken[]], // [ pred, objects ]
    PREFIX: [ string, string | undefined ], // [ prefix, uri ]
    PREFIXED_IRI: string,
    RDF_LITERAL: [ string, LexerToken | undefined, string | undefined ] // [ value, type, lang ]
    SYMBOLIC_IRI: '@a' | 'a' | '=' | '=>' | '<=',
    TRIPLE_DATA: [ LexerToken, LexerToken[]], // [ subject, propertyList ]
    UNIVERSAL: LexerToken[],
    VARIABLE: string,
  };

  export type LexerToken<key extends keyof LexerTokenMap = any> = { type: typeof N3Lexer.terms[key]; value: LexerTokenMap[key] };

  export class N3Lexer {
    terms = {
      BASE: 'Base',
      BLANK_TRIPLE_DATA: 'BlankTripleData',
      BOOLEAN_LITERAL: 'BooleanLiteral',
      DOCUMENT: 'Document',
      EXISTENTIAL: 'Existential',
      EXPLICIT_IRI: 'ExplicitIRI',
      FORMULA: 'Formula',
      LIST: 'List',
      NUMERIC_LITERAL: 'NumericLiteral',
      PREDICATE_OBJECT: 'PredicateObject',
      PREFIX: 'Prefix',
      PREFIXED_IRI: 'PrefixedIRI',
      RDF_LITERAL: 'RDFLiteral',
      SYMBOLIC_IRI: 'SymbolicIRI',
      TRIPLE_DATA: 'TripleData',
      UNIVERSAL: 'Universal',
      VARIABLE: 'Variable',
    } as const;

    parse(n3: string): LexerToken;
  }

  export class N3Parser {
    toJSONLD(n3: string): object;
  }

  export class JSONLDParser {
    toN3(jsonld: object): string;
  }
}

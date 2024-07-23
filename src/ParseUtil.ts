import type { BlankNode } from '@rdfjs/types';
import { DataFactory } from 'n3';
import { N3Parser } from 'n3-parser.js';
import { stringToTerm } from 'rdf-string';
import type { Binding } from './BindUtil';
import type { Clause } from './ClauseUtil';
import type { FancyQuad, FancyTerm, Graph, List } from './FancyUtil';

const DF = DataFactory;

export type Formula = {
  data: FancyQuad[];
  surfaces: NegativeSurface[];
};

export type NegativeSurface = {
  graffiti: BlankNode[];
  formula: Formula;
  answer: boolean;
};

const ON_NEGATIVE_SURFACE = 'http://www.w3.org/2000/10/swap/log#onNegativeSurface';
const ON_NEGATIVE_COMPONENT_SURFACE = 'http://www.w3.org/2000/10/swap/log#onNegativeComponentSurface';
const ON_NEGATIVE_QUESTION_SURFACE = 'http://www.w3.org/2000/10/swap/log#onNegativeQuestionSurface';
const ON_NEGATIVE_ANSWER_SURFACE = 'http://www.w3.org/2000/10/swap/log#onNegativeAnswerSurface';
const NEGATIVE_SURFACE_PREDICATES = [
  ON_NEGATIVE_SURFACE,
  ON_NEGATIVE_COMPONENT_SURFACE,
  ON_NEGATIVE_QUESTION_SURFACE,
  ON_NEGATIVE_ANSWER_SURFACE,
] as const;
const RDF_TYPE = DF.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');

export const QUAD_POSITIONS = [ 'subject', 'predicate', 'object' ] as const;

export function parseRoot(n3: string): Formula {
  const result = new N3Parser().toJSONLD(n3) as Record<string, object>;
  const context = result['@context'] as Record<string, string>;
  let body = result;
  if (!('@graph' in body)) {
    delete result['@context'];
    // eslint-disable-next-line ts/naming-convention
    body = { '@graph': result };
  }
  return parseFormula(body, context);
}

function parseFormula(graph: Record<string, unknown>, prefixes: Record<string, string>): Formula {
  if (!graph['@graph']) {
    throw new Error(`Unexpected formula: ${JSON.stringify(graph)}`);
  }
  const subGraph = (
    Array.isArray(graph['@graph']) ?
      graph['@graph'] :
        [ graph['@graph'] ]
  ) as Record<string, unknown>[];

  const result: Formula = {
    data: [],
    surfaces: [],
  };
  for (const entry of subGraph) {
    const parsed = parseEntry(entry, prefixes);
    if (Array.isArray(parsed)) {
      result.data.push(...parsed);
    } else {
      result.surfaces.push(parsed);
    }
  }
  return result;
}

function parseEntry(entry: Record<string, unknown>, prefixes: Record<string, string>): FancyQuad[] | NegativeSurface {
  removePrefixes(entry, prefixes);
  if ('@list' in entry) {
    // Negative surfaces
    let surfacePred: string | undefined;
    for (const pred of NEGATIVE_SURFACE_PREDICATES) {
      if (pred in entry) {
        surfacePred = pred;
        break;
      }
    }
    if (surfacePred) {
      const graffiti = parseGraffiti(entry['@list'] as object[]);
      const formula = parseFormula(entry[surfacePred] as Record<string, unknown>, prefixes);
      return { graffiti, formula, answer: ON_NEGATIVE_ANSWER_SURFACE in entry };
    }
  }

  // Data
  return parseQuads(entry, prefixes);
}

function removePrefixes(entry: Record<string, unknown>, prefixes: Record<string, string>): void {
  const prefixKeys = Object.keys(prefixes);
  for (const [ key, value ] of Object.entries(entry)) {
    const prefixMatch = prefixKeys.find((prefix): boolean => key.startsWith(`${prefix}:`));
    if (prefixMatch) {
      delete entry[key];
      const newKey = prefixes[prefixMatch] + key.slice(`${prefixMatch}:`.length);
      entry[newKey] = value;
    }
  }
  for (const key of [ '@id', '@type' ]) {
    let value = entry[key] as string | string[] | undefined;
    if (value) {
      value = Array.isArray(value) ? value : [ value ];
      value = value.map((child): string => {
        const prefixMatch = prefixKeys.find((prefix): boolean => child.startsWith(prefix));
        if (prefixMatch) {
          return prefixes[prefixMatch] + child.slice(`${prefixMatch}:`.length);
        }
        return child;
      });
      entry[key] = value.length === 1 ? value[0] : value;
    }
  }
}

function parseGraffiti(graffiti: object[]): BlankNode[] {
  const result: BlankNode[] = [];
  for (const entry of graffiti) {
    if (!('@id' in entry) || typeof entry['@id'] !== 'string' || !entry['@id'].startsWith('_:')) {
      throw new Error(`Invalid graffiti entry: ${JSON.stringify(entry)}`);
    }
    result.push(DF.blankNode(entry['@id'].slice(2)));
  }
  return result;
}

function parseQuads(
  input: Record<string, unknown> | Record<string, unknown>[],
  prefixes: Record<string, string>,
  subject?: FancyTerm,
  predicate?: FancyTerm,
): FancyQuad[] {
  if (Array.isArray(input)) {
    return input.flatMap((child): FancyQuad[] => parseQuads(child, prefixes, subject, predicate));
  }
  removePrefixes(input, prefixes);

  const newSubject = parseTerm(input, prefixes);
  const result: FancyQuad[] = [];

  if (subject && predicate) {
    result.push(createFancyQuad(subject, predicate, newSubject));
  }

  // For each field: either it's a new object with an @id, so recurse (unless only field),
  // it's a string, so parse, or could be complex value object
  for (const key of Object.keys(input)) {
    if (key.startsWith('@') && key !== '@type') {
      continue;
    }

    const val = input[key];
    if (key === '@type') {
      if (newSubject.termType === 'Literal') {
        // Type was already parsed as datatype when parsing term
        continue;
      }
      if (Array.isArray(val)) {
        result.push(...val.map((child): FancyQuad =>
          createFancyQuad(newSubject, RDF_TYPE, stringToTerm(child as string))));
      } else {
        result.push(createFancyQuad(newSubject, RDF_TYPE, stringToTerm(val as string)));
      }
    } else if (typeof val === 'object') {
      result.push(...parseQuads(val as Record<string, unknown>, prefixes, newSubject, stringToTerm(key)));
    } else {
      result.push(createFancyQuad(newSubject, stringToTerm(key), parseTerm(val, prefixes)));
    }
  }

  return result;
}

function createFancyQuad(subject: FancyTerm, predicate: FancyTerm, object: FancyTerm): FancyQuad {
  return { subject, predicate, object };
}

// TODO: no way to differentiate between literals and named nodes
function parseTerm(input: unknown, prefixes: Record<string, string>): FancyTerm {
  if (typeof input === 'string') {
    return DF.literal(input);
  }

  if (typeof input === 'number') {
    return DF.literal(`${input}`, DF.namedNode('http://www.w3.org/2001/XMLSchema#number'));
  }

  if (typeof input === 'boolean') {
    return DF.literal(`${input}`, DF.namedNode('http://www.w3.org/2001/XMLSchema#boolean'));
  }

  if (typeof input === 'object') {
    if ('@id' in input!) {
      const id = input['@id'] as string;
      return id.startsWith('_:') ? DF.blankNode(id.slice(2)) : DF.namedNode(id);
    }
    if ('@value' in input!) {
      if ('@type' in input) {
        return DF.literal(input['@value'] as string, DF.namedNode(input['@type'] as string));
      }
      if ('@language' in input) {
        return DF.literal(input['@value'] as string, input['@language'] as string);
      }
      return parseTerm(input['@value'], prefixes);
    }
    if ('@list' in input!) {
      return {
        termType: 'List',
        value: (input['@list'] as unknown[]).flatMap((child): FancyTerm => parseTerm(child, prefixes)),
      } satisfies List;
    }
    if ('@graph' in input!) {
      return {
        termType: 'Graph',
        value: (input['@graph'] as unknown[])
          .flatMap((child): FancyQuad[] => parseQuads(child as Record<string, unknown>, prefixes)),
      } satisfies Graph;
    }
  }

  throw new Error(`Unable to parse input into term: ${JSON.stringify(input)}`);
}

// TODO: pretty option with indentation and stuff
export function stringifyClause(clause: Clause): string {
  const members: string[] = [];
  for (const quad of clause.positive) {
    members.push(stringifyQuad(quad));
  }
  for (const quad of clause.negative) {
    members.push(stringifyQuad(quad, false));
  }
  members.push(...clause.clauses.map((child): string => `(${stringifyClause(child)})`));
  return members.join(` ${clause.conjunction ? '&&' : '||'} `);
}

export function stringifyQuad(quad: FancyQuad, positive = true): string {
  return `${positive ? '' : '-'}(${stringifyTerm(quad.subject)} ${
    stringifyTerm(quad.predicate)} ${stringifyTerm(quad.object)})`;
}

export function stringifyTerm(term: FancyTerm): string {
  if (term.termType === 'NamedNode') {
    if (term.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
      return 'a';
    }
    return `<${term.value}>`;
  }
  if (term.termType === 'BlankNode') {
    return `_:${term.value}`;
  }
  if (term.termType === 'Literal') {
    if (term.datatype.value === 'http://www.w3.org/2001/XMLSchema#boolean' ||
      term.datatype.value === 'http://www.w3.org/2001/XMLSchema#number' ||
      term.datatype.value === 'http://www.w3.org/2001/XMLSchema#integer') {
      return term.value;
    }
    if (term.language) {
      return `"${term.value}"@${term.language}`;
    }
    if (term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
      return `"${term.value}"^^<${term.datatype.value}>`;
    }
    return `"${term.value}"`;
  }
  if (term.termType === 'Graph') {
    return `{ ${term.value.map((quad): string => stringifyQuad(quad)).join('. ')} }`;
  }
  if (term.termType === 'List') {
    return `( ${term.value.map(stringifyTerm).join(' ')} )`;
  }
  throw new Error(`Unsupported term type ${term.termType}`);
}

export function stringifyBinding(binding: Binding): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(binding).map(([ key, value ]): [ string, string ] => [ key, stringifyTerm(value) ]),
  ));
}

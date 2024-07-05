import { BlankNode, NamedNode, Quad, Term } from '@rdfjs/types';
import { DataFactory, Store } from 'n3';
import { N3Parser } from 'n3-parser.js';
import { quadToStringQuad } from 'rdf-string';
import { Clause, createClause } from './ClauseUtil';

const DF = DataFactory;

export type Formula = {
  data: Store;
  surfaces: NegativeSurface[];
}

export type NegativeSurface = {
  graffiti: BlankNode[];
  formula: Formula;
  answer: boolean;
}

const ON_NEGATIVE_SURFACE = 'http://www.w3.org/2000/10/swap/log#onNegativeSurface';
const ON_NEGATIVE_ANSWER_SURFACE = 'http://www.w3.org/2000/10/swap/log#onNegativeAnswerSurface';
const RDF_TYPE = DF.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');

export const QUAD_POSITIONS = [ 'subject', 'predicate', 'object' ] as const;

export function parseRoot(n3: string): Formula {
  const result = new N3Parser().toJSONLD(n3) as Record<string, object>;
  const context = result['@context'] as Record<string, string>;
  let body = result;
  if (!('@graph' in body)) {
    delete result['@context'];
    body = { '@graph': result };
  }
  return parseFormula(body, context);
}

function parseFormula(graph: Record<string, unknown>, prefixes: Record<string, string>): Formula {
  if (!graph['@graph']) {
    throw new Error(`Unexpected formula: ${JSON.stringify(graph)}`);
  }
  const subGraph = Array.isArray(graph['@graph']) ? graph['@graph'] : [ graph['@graph'] ];
  
  const result: Formula = {
    data: new Store(),
    surfaces: [],
  }
  for (const entry of subGraph) {
    const parsed = parseEntry(entry, prefixes);
    if (Array.isArray(parsed)) {
      result.data.addQuads(parsed);
    } else {
      result.surfaces.push(parsed);
    }
  }
  return result;
}

function parseEntry(entry: Record<string, unknown>, prefixes: Record<string, string>): Quad[] | NegativeSurface {
  removePrefixes(entry, prefixes);
  if ('@list' in entry) {
    if (!(ON_NEGATIVE_SURFACE in entry) && !(ON_NEGATIVE_ANSWER_SURFACE in entry)) {
      throw new Error(`Please don't put lists in subject for now, thank you! ${JSON.stringify(entry)}`);
    }
    // Negative surfaces
    const graffiti = parseGraffiti(entry['@list'] as object[]);
    const formula = parseFormula(entry[ON_NEGATIVE_SURFACE] as Record<string, unknown> || entry[ON_NEGATIVE_ANSWER_SURFACE], prefixes);
    return { graffiti, formula: formula as Formula, answer: ON_NEGATIVE_ANSWER_SURFACE in entry};
  } else if ('@id' in entry ){
    // Data
    // TODO: this doesn't support complexer triples that N3 allows
    //       mostly just lists, nobody likes lists
    return parseQuads(entry, prefixes);
  }

  throw new Error(`Unexpected entry ${JSON.stringify(entry)}`);
}

function removePrefixes(entry: Record<string, unknown>, prefixes: Record<string, string>): void {
  const prefixKeys = Object.keys(prefixes);
  for (const [ key, value ] of Object.entries(entry)) {
    const prefixMatch = prefixKeys.find(prefix => key.startsWith(`${prefix}:`));
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
        const prefixMatch = prefixKeys.find(prefix => child.startsWith(prefix));
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

function parseQuads(input: Record<string, unknown> | Record<string, unknown>[], prefixes: Record<string, string>, subject?: NamedNode | BlankNode, predicate?: NamedNode): Quad[] {
  if (Array.isArray(input)) {
    return input.flatMap((child): Quad[] => parseQuads(child, prefixes, subject, predicate));
  }
  removePrefixes(input, prefixes);
  if (!input['@id']) {
    // TODO: literals
    throw new Error(`Missing @id: ${JSON.stringify(input)}`);
  }
  const result: Quad[] = [];
  const id = input['@id'] as string;
  const newSubject = id.startsWith('_:') ? DF.blankNode(id.slice(2)) : DF.namedNode(id);
  if (subject && predicate) {
    result.push(DF.quad(subject, predicate, newSubject));
  }
  
  // For each field: either it's a new object with an @id, so recurse (unless only field), it's a string, so parse, or could be complex value object
  for (const key of Object.keys(input)) {
    if (key === '@id') {
      continue;
    }

    const val = input[key];
    if (key === '@type') {
      if (!val) {
        // TODO: workaround for bug in parser that sets types to `null` sometimes
        //       example: https://github.com/eyereasoner/rdfsurfaces-tests/blob/main/test/pure/rdfs.n3s
        continue;
      }
      if (Array.isArray(val)) {
        result.push(...val.map((child): Quad => DF.quad(newSubject, RDF_TYPE, DF.namedNode(child))))
      } else {
        result.push(DF.quad(newSubject, RDF_TYPE, DF.namedNode(val as string)));
      }
    } else if (typeof val === 'string' || typeof val === 'number') {
      result.push(DF.quad(newSubject, DF.namedNode(key), DF.literal(val)));
    } else if (typeof val === 'boolean') {
      result.push(DF.quad(newSubject, DF.namedNode(key), DF.literal(`${val}`, DF.namedNode('http://www.w3.org/2001/XMLSchema#boolean'))));
    } else {
      result.push(...parseQuads(val as Record<string, unknown>, prefixes, newSubject, DF.namedNode(key)));
    }
  }

  return result;
}

// Interpret the results of an answer clause as a clause that needs to be fulfilled
// TODO: assuming only 1 answer surface
export function findAnswerClause(formula: Formula, level = 0): Clause {
  for (const surface of formula.surfaces) {
    if (surface.answer) {
      return extractAnswerClause(surface, level);
    }
    try {
      return findAnswerClause(surface.formula);
    } catch {}
  }
  throw new Error(`Could not find an answer surface.`);
}

function extractAnswerClause(surface: NegativeSurface, level: number): Clause {
  if (surface.formula.surfaces.length > 0) {
    throw new Error('Complex answer surfaces are not supported.');
  }
  
  const positiveLevel = level % 2 === 0;
  
  return createClause({
    conjunction: positiveLevel,
    positive: positiveLevel ? surface.formula.data : new Store(),
    negative: positiveLevel ? new Store() : surface.formula.data,
  });
}

export function toSimpleFormula(formula: Formula): Record<keyof Formula, unknown> {
  const data = formula.data.getQuads(null, null, null, null).map(quadToStringQuad);
  const surfaces = formula.surfaces.map(toSimpleSurface);
  return { data, surfaces };
}

export function toSimpleSurface(surface: NegativeSurface): Record<keyof NegativeSurface, unknown> {
  const graffiti = surface.graffiti.map(stringifyTerm);
  const formula = toSimpleFormula(surface.formula);
  return { graffiti, formula, answer: surface.answer };
}

// TODO: pretty option with indentation and stuff
export function stringifyClause(clause: Clause): string {
  const members: string[] = [];
  for (const quad of clause.positive) {
    members.push(stringifyQuad(quad));
  }
  for (const quad of clause.negative) {
    members.push(stringifyQuad(quad, true));
  }
  members.push(...clause.clauses.map((child): string => `(${stringifyClause(child)})`));
  return members.join(` ${clause.conjunction ? '&&' : '||'} `);
}

export function stringifyQuad(quad: Quad, negated: boolean = false): string {
  return `${negated ? '-' : ''}(${stringifyTerm(quad.subject)} ${stringifyTerm(quad.predicate)} ${stringifyTerm(quad.object)})`;
}

export function stringifyTerm(term: Term): string {
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
    if (term.datatype.value === 'http://www.w3.org/2001/XMLSchema#boolean' || term.datatype.value === 'http://www.w3.org/2001/XMLSchema#number') {
      return term.value;
    }
    return `"${term.value}"`;
  }
  throw new Error('Unsupported term type ' + term.termType);
}
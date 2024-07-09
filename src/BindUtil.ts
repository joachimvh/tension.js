import { NamedNode, Quad, Term } from '@rdfjs/types';
import { DataFactory } from 'n3';
import { Clause, createClause, RootClause } from './ClauseUtil';
import { QUAD_POSITIONS } from './ParseUtil';
import { isUniversal } from './SimplifyUtil';

export function* findBindings(root: RootClause): IterableIterator<Record<string, Term>> {
  for (const clause of root.clauses) {
    yield* findClauseBindings(root, clause);
  }
}

// TODO: just trying to find any matching triples in the hope to get something interesting
export function* findClauseBindings(root: RootClause, clause: Clause): IterableIterator<Record<string, Term>> {
  for (const child of clause.clauses) {
    yield* findClauseBindings(root, child);
  }
  for (const side of [ 'positive', 'negative' ] as const) {
    for (const quad of clause[side]) {
      for (const rootSide of [ 'positive', 'negative' ] as const) {
        for (const rootQuad of root[rootSide]) {
          const binding = getBinding(quad, rootQuad, root.quantifiers);
          if (binding) {
            yield binding;
          }
        }
      }
    }
  }
}

// TODO: left one is the one that should have the universals
export function getBinding(left: Quad, right: Quad, quantifiers: Record<string, number>): Record<string, Term> | undefined {
  let binding: Record<string, Term> = {};
  for (const pos of QUAD_POSITIONS) {
    const leftTerm = left[pos];
    const rightTerm = right[pos];
    if (isUniversal(leftTerm, quantifiers)) {
      binding[leftTerm.value] = rightTerm;
    } else if (!leftTerm.equals(rightTerm)) {
      return;
    }
  }
  if (Object.keys(binding).length > 0) {
    return binding;
  }
}

// TODO: undefined implies there was no change
export function applyBindings(clause: Clause, bindings: Record<string, Term>): Clause | undefined {
  const children = clause.clauses.map((child): Clause | undefined => applyBindings(child, bindings));
  let change = children.some((child): boolean => Boolean(child));
  const clauses = change ? children.map((child, idx): Clause => child ?? clause.clauses[idx]) : clause.clauses;
  const boundPositive = applyBindingsToQuads(clause.positive, bindings);
  const boundNegative = applyBindingsToQuads(clause.negative, bindings);
  change = change || Boolean(boundPositive) || Boolean(boundNegative);
  if (change) {
    return createClause({
      conjunction: clause.conjunction,
      positive: boundPositive ?? clause.positive,
      negative: boundNegative ?? clause.negative,
      clauses,
    });
  }
}

export function applyBindingsToQuads(quads: Quad[], bindings: Record<string, Term>): Quad[] | undefined {
  let change = false;
  let bound: Quad[] = [];
  for (const quad of quads) {
    let updateQuad = false;
    let boundQuad: Partial<Quad> = {};
    for (const pos of QUAD_POSITIONS) {
      if (quad[pos].termType !== 'BlankNode') {
        continue;
      }
      const binding = bindings[quad[pos].value];
      if (!binding) {
        continue;
      }
      // Trust me bro
      boundQuad[pos] = binding as NamedNode;
      updateQuad = true;
      change = true;
    }
    bound.push(updateQuad ? DataFactory.quad(
      boundQuad.subject ?? quad.subject,
      boundQuad.predicate ?? quad.predicate,
      boundQuad.object ?? quad.object,
    ): quad);
  }
  if (change) {
    return bound;
  }
}

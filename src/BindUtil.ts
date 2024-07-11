import { Clause, createClause, RootClause } from './ClauseUtil';
import { fancyEquals, FancyQuad, FancyTerm } from './FancyUtil';
import { QUAD_POSITIONS } from './ParseUtil';
import { isUniversal } from './SimplifyUtil';

export function* findBindings(root: RootClause): IterableIterator<Record<string, FancyTerm>> {
  for (const clause of root.clauses) {
    yield* findClauseBindings(root, clause);
  }
}

// TODO: just trying to find any matching triples in the hope to get something interesting
export function* findClauseBindings(root: RootClause, clause: Clause): IterableIterator<Record<string, FancyTerm>> {
  for (const child of clause.clauses) {
    yield* findClauseBindings(root, child);
  }
  for (const side of [ 'positive', 'negative' ] as const) {
    for (const quad of clause[side]) {
      for (const rootSide of [ 'positive', 'negative' ] as const) {
        for (const rootQuad of root[rootSide]) {
          const binding = getBinding(quad, rootQuad, root.quantifiers);
          if (binding && Object.keys(binding).length > 0) {
            yield binding;
          }
        }
      }
    }
  }
}

// TODO: left one is the one that should have the universals
// TODO: returns undefined if no binding is possible, returns {} if a binding is possible but no mappings are needed
export function getBinding(left: FancyQuad, right: FancyQuad, quantifiers: Record<string, number>): Record<string, FancyTerm> | undefined {
  // TODO: might have to differentiate between no mapping and impossible mapping?
  let binding: Record<string, FancyTerm> = {};
  for (const pos of QUAD_POSITIONS) {
    const result = getTermBinding(left[pos], right[pos], quantifiers);
    if (!result) {
      return;
    }
    // TODO: check for conflicting bindings?
    Object.assign(binding, result);
  }
  return binding;
}

export function getTermBinding(left: FancyTerm, right: FancyTerm, quantifiers: Record<string, number>): Record<string, FancyTerm> | undefined {
  const result: Record<string, FancyTerm> = {};

  if (left.termType === 'Graph' || left.termType === 'List') {
    if (right.termType !== left.termType) {
      return;
    }
    const callback = left.termType === 'Graph' ? getBinding : getTermBinding;
    for (let i = 0; i < left.value.length; ++i) {
      // TODO: check for conflicting bindings?
      const partial = callback(left.value[i] as any, right.value[i] as any, quantifiers);
      if (!partial) {
        return;
      }
      Object.assign(result, partial);
    }
    return result;
  }

  if (isUniversal(left, quantifiers)) {
    result[left.value] = right;
  } else if (!fancyEquals(left, right)) {
    return;
  }

  return result;
}

// TODO: undefined implies there was no change
export function applyBindings(clause: Clause, bindings: Record<string, FancyTerm>): Clause | undefined {
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

export function applyBindingsToQuads(quads: FancyQuad[], bindings: Record<string, FancyTerm>): FancyQuad[] | undefined {
  let change = false;
  let bound: FancyQuad[] = [];
  for (const quad of quads) {
    const boundQuad = applyBindingsToQuad(quad, bindings);
    if (boundQuad) {
      change = true;
      bound.push(boundQuad);
    } else {
      bound.push(quad);
    }
  }
  if (change) {
    return bound;
  }
}

export function applyBindingsToQuad(quad: FancyQuad, bindings: Record<string, FancyTerm>): FancyQuad | undefined {
  let updateQuad = false;
  let boundQuad: Partial<FancyQuad> = {};
  for (const pos of QUAD_POSITIONS) {
    const boundTerm = applyBindingsToTerm(quad[pos], bindings);
    if (boundTerm) {
      boundQuad[pos] = boundTerm;
      updateQuad = true;
    }
  }
  if (updateQuad) {
    return {
      ...quad,
      ...boundQuad,
    };
  }
}

export function applyBindingsToTerm(term: FancyTerm, bindings: Record<string, FancyTerm>): FancyTerm | undefined {
  if (term.termType === 'Graph' || term.termType === 'List') {
    let change = false;
    let boundValues: (FancyQuad | FancyTerm)[] = [];
    const callback = term.termType === 'Graph' ? applyBindingsToQuad : applyBindingsToTerm;
    for (const child of term.value) {
      const boundQuad = callback(child as any, bindings);
      if (boundQuad) {
        change = true;
        boundValues.push(boundQuad);
      } else {
        boundValues.push(child);
      }
    }
    return change ? { ...term, value: boundValues as any } : term;
  }

  if (term.termType !== 'BlankNode') {
    return;
  }
  return bindings[term.value];
}

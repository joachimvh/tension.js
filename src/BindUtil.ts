import { Clause, createClause, RootClause } from './ClauseUtil';
import { fancyEquals, FancyQuad, FancyTerm } from './FancyUtil';
import { QUAD_POSITIONS } from './ParseUtil';
import { isUniversal } from './SimplifyUtil';

export type Binding = Record<string, FancyTerm>;

export type BindCache = {
  clauses: WeakSet<Clause>,
  quads: WeakSet<FancyQuad>,
  bindings: Binding[],
}

// TODO: make optional
// Using a WeakSet so clauses that get removed from root don't get checked afterwards
export function* findBindings(root: RootClause, cache?: BindCache): IterableIterator<Binding> {
  cache = cache || { clauses: new WeakSet(), quads: new WeakSet(), bindings: [] };
  for (const clause of root.clauses) {
    for (const binding of findClauseBindings(root, clause, cache)) {
      if (cache.bindings.some((cached): boolean => isSameBinding(binding, cached))) {
        continue;
      }
      yield binding;
    }
  }
  // Only add root quads after having checked with the clauses
  for (const quad of root.positive) {
    cache.quads.add(quad);
  }
  for (const quad of root.negative) {
    cache.quads.add(quad);
  }
}

// TODO: just trying to find any matching triples in the hope to get something interesting
export function* findClauseBindings(root: RootClause, clause: Clause, cache: BindCache): IterableIterator<Binding> {
  const cachedClause = !clause.conjunction && cache.clauses.has(clause);
  for (const child of clause.clauses) {
    yield* findClauseBindings(root, child, cache);
  }
  for (const side of [ 'positive', 'negative' ] as const) {
    for (const rootQuad of root[side]) {
      if (cachedClause && cache.quads.has(rootQuad)) {
        continue;
      }
      yield* findRootQuadBindings(rootQuad, clause, root.quantifiers);
    }
  }
  // Only caching disjunctions as conjunctions are contained within anyway
  if (!clause.conjunction) {
    cache.clauses.add(clause);
  }
}

export function* findRootQuadBindings(rootQuad: FancyQuad, clause: Clause, quantifiers: Record<string, number>): IterableIterator<Binding> {
  for (const child of clause.clauses) {
    yield* findRootQuadBindings(rootQuad, child, quantifiers);
  }
  for (const side of [ 'positive', 'negative' ] as const) {
    for (const quad of clause[side]) {
      const binding = getBinding(rootQuad, quad, quantifiers);
      if (binding && Object.keys(binding).length > 0) {
        yield binding;
      }
    }
  }
}

// TODO: returns undefined if no binding is possible, returns {} if a binding is possible but no mappings are needed
export function getBinding(left: FancyQuad, right: FancyQuad, quantifiers: Record<string, number>): Binding | undefined {
  // TODO: might have to differentiate between no mapping and impossible mapping?
  let binding: Binding = {};
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

export function getTermBinding(left: FancyTerm, right: FancyTerm, quantifiers: Record<string, number>): Binding | undefined {
  const result: Binding = {};

  if (isUniversal(left, quantifiers)) {
    if (result[left.value] && !fancyEquals(result[left.value], right)) {
      return;
    }
    result[left.value] = right;
  } else if (isUniversal(right, quantifiers)) {
    if (result[right.value] && !fancyEquals(result[right.value], left)) {
      return;
    }
    result[right.value] = left;
  } else if (left.termType === 'Graph' || left.termType === 'List') {
    if (right.termType !== left.termType) {
      return;
    }
    const callback = left.termType === 'Graph' ? getBinding : getTermBinding;
    for (let i = 0; i < left.value.length; ++i) {
      const partial = callback(left.value[i] as any, right.value[i] as any, quantifiers);
      if (!partial) {
        return;
      }
      Object.assign(result, partial);
    }
    return result;
  } else if (!fancyEquals(left, right)) {
    return;
  }

  return result;
}

// TODO: undefined implies there was no change
export function applyBindings(clause: Clause, bindings: Binding): Clause | undefined {
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

export function applyBindingsToQuads(quads: FancyQuad[], bindings: Binding): FancyQuad[] | undefined {
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

export function applyBindingsToQuad(quad: FancyQuad, bindings: Binding): FancyQuad | undefined {
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

export function applyBindingsToTerm(term: FancyTerm, bindings: Binding): FancyTerm | undefined {
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

export function isSameBinding(left: Record<string, FancyTerm>, right: Record<string, FancyTerm>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  leftKeys.sort();
  rightKeys.sort();
  for (const [ idx, key ] of leftKeys.entries()) {
    if (key !== rightKeys[idx]) {
      return false;
    }
    if (!fancyEquals(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

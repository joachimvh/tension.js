import type { Clause, RootClause } from './ClauseUtil';
import { createClause, POSITIVE_NEGATIVE } from './ClauseUtil';
import type { FancyQuad, FancyTerm } from './FancyUtil';
import { fancyEquals, isUniversal } from './FancyUtil';
import { QUAD_POSITIONS } from './ParseUtil';

export type Binding = Record<string, FancyTerm>;

export type BindCache = {
  clauses: WeakSet<Clause>;
  quads: WeakSet<FancyQuad>;
};

export type BindResult = {
  binding: Binding;
  clause: Clause;
};

// Using a WeakSet so clauses that get removed from root don't get checked afterwards
export function* findBindResults(root: RootClause, cache?: BindCache): IterableIterator<BindResult> {
  cache = cache ?? { clauses: new WeakSet(), quads: new WeakSet() };
  for (const clause of root.clauses) {
    for (const binding of findClauseBindings(root, clause, cache)) {
      yield { clause, binding };
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
  for (const side of POSITIVE_NEGATIVE) {
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

export function* findRootQuadBindings(rootQuad: FancyQuad, clause: Clause, quantifiers: Record<string, number>):
IterableIterator<Binding> {
  for (const child of clause.clauses) {
    yield* findRootQuadBindings(rootQuad, child, quantifiers);
  }
  for (const side of POSITIVE_NEGATIVE) {
    for (const quad of clause[side]) {
      const binding = getBinding(rootQuad, quad, quantifiers);
      if (binding && Object.keys(binding).length > 0) {
        yield binding;
      }
    }
  }
}

// TODO: returns undefined if no binding is possible, returns {} if a binding is possible but no mappings are needed
export function getBinding(left: FancyQuad, right: FancyQuad, quantifiers: Record<string, number>): Binding | undefined;
export function getBinding(left: FancyTerm, right: FancyTerm, quantifiers: Record<string, number>): Binding | undefined;
export function getBinding(
  left: FancyQuad | FancyTerm,
  right: FancyQuad | FancyTerm,
  quantifiers: Record<string, number>,
): Binding | undefined {
  if ('value' in left) {
    return getTermBinding(left, right as FancyTerm, quantifiers);
  }
  const binding: Binding = {};
  for (const pos of QUAD_POSITIONS) {
    const result = getTermBinding(left[pos], (right as FancyQuad)[pos], quantifiers);
    if (!result) {
      return;
    }
    // TODO: check for conflicting bindings?
    Object.assign(binding, result);
  }
  return binding;
}

function getTermBinding(left: FancyTerm, right: FancyTerm, quantifiers: Record<string, number>):
  Binding | undefined {
  const result: Binding = {};

  const equal = fancyEquals(left, right);

  if (equal) {
    return {};
  }

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
    if (left.termType !== right.termType || left.value.length !== right.value.length) {
      return;
    }

    for (let i = 0; i < left.value.length; ++i) {
      const partial = getBinding(
        left.value[i] as FancyQuad & FancyTerm,
        right.value[i] as FancyQuad & FancyTerm,
        quantifiers,
      );
      if (!partial) {
        return;
      }
      Object.assign(result, partial);
    }
    return result;
  } else if (!equal) {
    return;
  }

  return result;
}

// TODO: undefined implies there was no change
export function applyBinding(clause: Clause, bindings: Binding): Clause | undefined;
export function applyBinding(quads: FancyQuad[], bindings: Binding): FancyQuad[] | undefined;
export function applyBinding(quad: FancyQuad, bindings: Binding): FancyQuad | undefined;
export function applyBinding(term: FancyTerm, bindings: Binding): FancyTerm | undefined;
export function applyBinding(input: Clause | FancyQuad[] | FancyQuad | FancyTerm, bindings: Binding):
  Clause | FancyQuad[] | FancyQuad | FancyTerm | undefined {
  if (Array.isArray(input)) {
    return applyBindingsToQuads(input, bindings);
  }

  if ('clauses' in input) {
    return applyBindingsToClause(input, bindings);
  }

  if ('subject' in input) {
    return applyBindingsToQuad(input, bindings);
  }

  return applyBindingsToTerm(input, bindings);
}

function applyBindingsToClause(clause: Clause, bindings: Binding): Clause | undefined {
  const children = clause.clauses.map((child): Clause | undefined => applyBinding(child, bindings));
  let change = children.some(Boolean);
  const clauses = change ? children.map((child, idx): Clause => child ?? clause.clauses[idx]) : clause.clauses;
  const boundPositive = applyBinding(clause.positive, bindings);
  const boundNegative = applyBinding(clause.negative, bindings);
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

function applyBindingsToQuads(quads: FancyQuad[], bindings: Binding): FancyQuad[] | undefined {
  let change = false;
  const bound: FancyQuad[] = [];
  for (const quad of quads) {
    const boundQuad = applyBinding(quad, bindings);
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

function applyBindingsToQuad(quad: FancyQuad, bindings: Binding): FancyQuad | undefined {
  let updateQuad = false;
  const boundQuad: Partial<FancyQuad> = {};
  for (const pos of QUAD_POSITIONS) {
    const boundTerm = applyBinding(quad[pos], bindings);
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

function applyBindingsToTerm(term: FancyTerm, bindings: Binding): FancyTerm | undefined {
  if (term.termType === 'Graph' || term.termType === 'List') {
    let change = false;
    const boundValues: (FancyQuad | FancyTerm)[] = [];
    for (const child of term.value) {
      const boundQuad = applyBinding(child as FancyQuad & FancyTerm, bindings);
      if (boundQuad) {
        change = true;
        boundValues.push(boundQuad);
      } else {
        boundValues.push(child);
      }
    }
    return change ? { ...term, value: boundValues as (FancyQuad & FancyTerm)[] } : term;
  }

  if (term.termType !== 'BlankNode') {
    return;
  }
  return bindings[term.value];
}

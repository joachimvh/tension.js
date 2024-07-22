import { applyBinding, getBinding } from './BindUtil';
import type { Clause, RootClause } from './ClauseUtil';
import { createClause, mergeData, POSITIVE_NEGATIVE } from './ClauseUtil';
import type { FancyQuad, FancyTerm } from './FancyUtil';
import { fancyEquals } from './FancyUtil';
import { getLogger } from './LogUtil';
import { stringifyClause } from './ParseUtil';

const logger = getLogger('Overlap');

export type ClauseOverlap = {
  left: {
    clause: Clause;
    remove: FancyQuad;
    // If the quad is in a conjunction
    removeClause?: Clause;
  };
  right: {
    clause: Clause;
    remove: FancyQuad;
    removeClause?: Clause;
  };
  leftPositive: boolean;
  binding: Record<string, FancyTerm>;
};

export type OverlapCache = WeakMap<Clause, WeakSet<Clause>>;

export function* findOverlappingClause(root: RootClause, cache: OverlapCache): IterableIterator<ClauseOverlap> {
  for (let i = 0; i < root.clauses.length; i++) {
    const clause = root.clauses[i];
    let clauseCache = cache.get(clause);
    if (!clauseCache) {
      clauseCache = new WeakSet();
      cache.set(clause, clauseCache);
    }
    for (let j = i + 1; j < root.clauses.length; j++) {
      const otherClause = root.clauses[j];
      if (clauseCache.has(otherClause)) {
        continue;
      }
      clauseCache.add(otherClause);
      const overlap = getClauseOverlap(clause, otherClause, root.quantifiers);
      if (overlap) {
        yield overlap;
      }
    }
  }
}

// TODO: (f(A) && A) || (g(B) && B) || C
//       \forall x: D || (-f(x) && E && F) || G
//       -> D || (((g(B) && B) || C) && E && F) || G
//       -> D || (g(B) && B && E && F) || (C && E && F) || G
//       ALSO: -> ((D || G) && A) || (g(B) && B) || C
//             -> (D && A) || (G && A) || (g(B) && B) || C
//       simpler example: (A && D) || B and (-A && -B) || C
//               give (C && D) || B and (B && -B) || C (which is more information than C || B and B || C)

// TODO: level 1
export function applyClauseOverlap(overlap: ClauseOverlap): Clause[] {
  // TODO: if left removeClause and right just quad:
  //       - remove `removeParent` from left clauses
  //       - remove right quad from triples
  //       - (cross product between remainder of right subclause,
  //          which is empty, and remaining left clause members, so just left remainder)
  //       - merge what remains of left and right
  //       but also:
  //       - remove right quad from right clause
  //       - remove left quad from `removeParent`
  //       - cross product between remaining left `removeParent` members and remaining right clause members
  //       - merge result with rest of left clause

  // Both results are the same if both match on a disjunction triple
  const results: Clause[] = [];
  // TODO: we might want to do this after the simplify step though...
  if (overlap.left.removeClause && overlap.right.removeClause) {
    results.push(applySubClauseOverlap(overlap, true), applySubClauseOverlap(overlap, false));
  } else if (overlap.left.removeClause ?? overlap.right.removeClause) {
    // TODO: still only need to generate one here, as the other one would be a simplified version
    //       e.g., A || B || C and (-A && D && E) || F || G
    //             generates B || C || F || G and (B && D && E) || (C && D && E) || F || G
    //             the latter one contains all the information of the first
    results.push(overlap.left.removeClause ?
      applySubClauseOverlap(overlap, true) :
      applySubClauseOverlap(overlap, false));
  } else {
    results.push(applyTripleClauseOverlap(overlap, true));
  }
  for (const clause of results) {
    logger.debug(`generated ${stringifyClause(clause)} from ${
      stringifyClause(overlap.left.clause)} and ${stringifyClause(overlap.right.clause)}`);
  }
  return results;
}

// TODO: assumes removeClause in the relevant side has a value
export function applySubClauseOverlap(overlap: ClauseOverlap, left: boolean): Clause {
  const side = left ? 'left' : 'right';
  const otherSide = left ? 'right' : 'left';
  const removeClause = overlap[side].removeClause;
  if (!removeClause) {
    throw new Error('This function should not be called if `removeClause` is not defined for this side.');
  }

  // In the clause where we replace a triple: the triples that have to remain.
  const crossPositive = [ ...removeClause.positive ];
  const crossNegative = [ ...removeClause.negative ];
  removeQuad(overlap.leftPositive === left ? crossPositive : crossNegative, overlap[side].remove);

  // In the clause that will be used as injection: the parts that are not removed.
  const otherPositive = [ ...overlap[otherSide].clause.positive ];
  const otherNegative = [ ...overlap[otherSide].clause.negative ];
  const otherClauses: Clause[] = [
    ...overlap[otherSide].removeClause ?
      overlap[otherSide].clause.clauses.filter((child): boolean => child !== overlap[otherSide].removeClause) :
      overlap[otherSide].clause.clauses,
  ];
  if (!overlap[otherSide].removeClause) {
    removeQuad(overlap.leftPositive === left ? otherNegative : otherPositive, overlap[otherSide].remove);
  }

  // For every part remaining in the "other" disjunction:
  // create a new disjunction entry and then combine these with the remaining parts of the initial disjunction
  const finalClauses: Clause[] = overlap[side].clause.clauses.filter((clause): boolean => clause !== removeClause);
  for (const quad of otherPositive) {
    finalClauses.push(createClause(
      { conjunction: true, positive: mergeData(quad, crossPositive), negative: crossNegative },
    ));
  }
  for (const quad of otherNegative) {
    finalClauses.push(createClause(
      { conjunction: true, positive: crossPositive, negative: mergeData(quad, crossNegative) },
    ));
  }
  for (const clause of otherClauses) {
    finalClauses.push(createClause({
      conjunction: true,
      positive: mergeData(crossPositive, clause.positive),
      negative: mergeData(crossNegative, clause.negative),
    }));
  }

  let result = createClause({
    conjunction: false,
    positive: overlap[side].clause.positive,
    negative: overlap[side].clause.negative,
    clauses: finalClauses,
  });

  result = applyBinding(result, overlap.binding) ?? result;

  // TODO: it's possible that the removeClause contains even more information about things that can be removed
  //       e.g., A || (B && D) and (-A && -B) || C.
  //         Standard solution would be to generate (B && D) || C, but actually this can be simplified to C
  const otherRemoveClause = overlap[otherSide].removeClause;
  const removeClauseIdx = new Set<number>();
  if (otherRemoveClause) {
    let boundQuads = applyBinding(otherRemoveClause.positive, overlap.binding) ?? otherRemoveClause.positive;
    for (const quad of boundQuads) {
      removeQuad(result.negative, quad);
      const idx = result.clauses.findIndex((clause): boolean =>
        clause.negative.some((child): boolean => fancyEquals(child, quad)));
      removeClauseIdx.add(idx);
    }
    boundQuads = applyBinding(otherRemoveClause.negative, overlap.binding) ?? otherRemoveClause.negative;
    for (const quad of boundQuads) {
      removeQuad(result.positive, quad);
      const idx = result.clauses.findIndex((clause): boolean =>
        clause.positive.some((child): boolean => fancyEquals(child, quad)));
      removeClauseIdx.add(idx);
    }
    if (removeClauseIdx.size > 0) {
      result.clauses = result.clauses.filter((clause, idx): boolean => !removeClauseIdx.has(idx));
    }
  }
  return result;
}

// TODO: it's impossible for this function to generate a clause that is bigger than the sum of its parents
// TODO: assumes removeClause in the relevant side has no value
export function applyTripleClauseOverlap(overlap: ClauseOverlap, left: boolean): Clause {
  const side = left ? 'left' : 'right';
  const otherSide = left ? 'right' : 'left';
  if (overlap.left.removeClause ?? overlap.right.removeClause) {
    throw new Error('This function should not be called if `removeClause` is defined for any side.');
  }

  // The remaining triples of the initial clause
  const positive = mergeData(overlap[side].clause.positive);
  const negative = mergeData(overlap[side].clause.negative);
  removeQuad(overlap.leftPositive === left ? positive : negative, overlap[side].remove);

  // The remaining triples/clauses of the other clause
  const otherPositive = mergeData(overlap[otherSide].clause.positive);
  const otherNegative = mergeData(overlap[otherSide].clause.negative);
  removeQuad(overlap.leftPositive === left ? otherNegative : otherPositive, overlap[otherSide].remove);

  // The combined clauses of both sides
  const clauses: Clause[] = [
    ...overlap[side].clause.clauses,
    ...overlap[otherSide].clause.clauses,
  ];

  // Generate the triples that will be in the new clause.
  // Note that we first keep them separate above
  //   in case one side would happen to have the triple that would be removed in the other.
  const mergedPositive = mergeData(positive, otherPositive);
  const mergedNegative = mergeData(negative, otherNegative);

  let result = createClause({
    conjunction: false,
    positive: mergedPositive,
    negative: mergedNegative,
    clauses,
  });
  result = applyBinding(result, overlap.binding) ?? result;

  return result;
}

export function removeQuad(quads: FancyQuad[], quad: FancyQuad): void {
  const idx = quads.indexOf(quad);
  if (idx >= 0) {
    quads.splice(quads.indexOf(quad), 1);
  }
}

// TODO: by stopping at the first hit we might miss other options (especially if we compare clause subsets)
//       could yield, probably more duplication and will need to change how we do caching potentially

// TODO: assuming level 1 clauses here
export function getClauseOverlap(left: Clause, right: Clause, quantifiers: Record<string, number>):
  ClauseOverlap | undefined {
  // Check for overlap with all left triples/clauses and right triples/clauses
  for (const leftSide of [ ...POSITIVE_NEGATIVE, 'clauses' ] as const) {
    for (const rightSide of [ ...POSITIVE_NEGATIVE, 'clauses' ] as const) {
      if (leftSide === rightSide && leftSide !== 'clauses') {
        // We are looking for A and -A, so comparing same sides doesn't make sense
        continue;
      }
      for (const leftEntry of left[leftSide]) {
        for (const rightQuad of right[rightSide]) {
          const overlap = findEntryOverlap(
            { clause: left, value: leftEntry },
            { clause: right, value: rightQuad },
            // If left side is a clause the sign will depend on the quad on the right side.
            // If both are clauses the value here doesn't matter.
            leftSide === 'clauses' ? rightSide === 'negative' : leftSide === 'positive',
            quantifiers,
          );
          if (overlap) {
            return overlap;
          }
        }
      }
    }
  }
}

export function findEntryOverlap(
  left: { clause: Clause; value: Clause | FancyQuad },
  right: { clause: Clause; value: Clause | FancyQuad },
  leftPositive: boolean,
  quantifiers: Record<string, number>,
): ClauseOverlap | undefined {
  if ('clauses' in left.value) {
    for (const side of POSITIVE_NEGATIVE) {
      for (const leftQuad of left.value[side]) {
        const overlap = findEntryOverlap(
          { clause: left.clause, value: leftQuad },
          right,
          side === 'positive',
          quantifiers,
        );
        if (overlap) {
          overlap.left.removeClause = left.value;
          return overlap;
        }
      }
    }
    return;
  }

  // TODO: implementing this as swapping the parameters in a recursive call does not work for some reason,
  //       need to investigate as that would simplify code
  // Left is a quad
  if ('clauses' in right.value) {
    for (const rightQuad of right.value[leftPositive ? 'negative' : 'positive']) {
      const overlap = findEntryOverlap(left, { clause: right.clause, value: rightQuad }, leftPositive, quantifiers);
      if (overlap) {
        overlap.right.removeClause = right.value;
        return overlap;
      }
    }
    return;
  }

  // Both are quads
  const binding = getBinding(left.value, right.value, quantifiers);
  if (binding) {
    return {
      left: { clause: left.clause, remove: left.value },
      right: { clause: right.clause, remove: right.value },
      leftPositive,
      binding,
    };
  }
}

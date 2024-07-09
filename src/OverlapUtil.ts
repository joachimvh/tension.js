import { Quad, Term } from '@rdfjs/types';
import { applyBindingsToQuads } from './BindUtil';
import { Clause, createClause, mergeData, RootClause } from './ClauseUtil';
import { getLogger } from './LogUtil';
import { QUAD_POSITIONS, stringifyClause } from './ParseUtil';
import { isUniversal } from './SimplifyUtil';

const logger = getLogger('Overlap');

// TODO: could limit this to 2 children each as otherwise we get bigger results anyway

export type ClauseOverlap = {
  left: {
    clause: Clause;
    remove: Quad;
    // If the quad is in a conjunction
    removeClause?: Clause;
  };
  right: {
    clause: Clause;
    remove: Quad;
    removeClause?: Clause;
  };
  leftPositive: boolean;
  binding: Record<string, Term>;
}

export function* findOverlappingClause(root: RootClause): IterableIterator<ClauseOverlap> {
  for (let i = 0; i < root.clauses.length; i++) {
    for (let j = i + 1; j < root.clauses.length; j++) {
      const overlap = getClauseOverlap(root.clauses[i], root.clauses[j], root.quantifiers);
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
  //       - (cross product between remainder of right subclause, which is empty, and remaining left clause members, so just left remainder)
  //       - merge what remains of left and right
  //       but also:
  //       - remove right quad from right clause
  //       - remove left quad from `removeParent`
  //       - cross product between remaining left `removeParent` members and remaining right clause members
  //       - merge result with rest of left clause

  // Both results are the same if both match on a disjunction triple
  let results: Clause[] = [];
  // TODO: we might want to do this after the simplify step though...
  if (overlap.left.removeClause || overlap.right.removeClause) {
    if (overlap.left.removeClause && overlap.right.removeClause) {
      results.push(applySubClauseOverlap(overlap, true), applySubClauseOverlap(overlap, false));
    } else {
      // TODO: still only need to generate one here, as the other one would be a simplified version
      //       e.g., A || B || C and (-A && D && E) || F || G
      //             generates B || C || F || G and (B && D && E) || (C && D && E) || F || G
      //             the latter one contains all the information of the first
      results.push(overlap.left.removeClause ? applySubClauseOverlap(overlap, true) : applySubClauseOverlap(overlap, false));
    }
  } else {
    results.push(applyTripleClauseOverlap(overlap, true));
  }
  for (const clause of results) {
    logger.debug(`generated ${stringifyClause(clause)} from ${stringifyClause(overlap.left.clause)} and ${stringifyClause(overlap.right.clause)}`);
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
  const crossPositive = mergeData(removeClause.positive);
  const crossNegative = mergeData(removeClause.negative);
  removeQuad(((overlap.leftPositive === left) ? crossPositive : crossNegative), overlap[side].remove);

  // In the clause that will be used as injection: the parts that are not removed.
  const otherPositive = mergeData(overlap[otherSide].clause.positive);
  const otherNegative = mergeData(overlap[otherSide].clause.negative);
  const otherClauses: Clause[] = [
    ...(overlap[otherSide].removeClause ? overlap[otherSide].clause.clauses.filter((child): boolean => child !== overlap[otherSide].removeClause) : overlap[otherSide].clause.clauses),
  ];
  if (!overlap[otherSide].removeClause) {
    removeQuad(((overlap.leftPositive === left) ? otherNegative : otherPositive), overlap[otherSide].remove);
  }

  // For every part remaining in the "other" disjunction: create a new disjunction entry and then combine these with the remaining parts of the initial disjunction
  const finalClauses: Clause[] = overlap[side].clause.clauses.filter((clause): boolean => clause !== removeClause);
  for (const quad of otherPositive) {
    finalClauses.push(createClause({ conjunction: true, positive: mergeData(quad, crossPositive), negative: crossNegative }));
  }
  for (const quad of otherNegative) {
    finalClauses.push(createClause({ conjunction: true, positive: crossPositive, negative: mergeData(quad, crossNegative) }));
  }
  for (const clause of otherClauses) {
    finalClauses.push(createClause({ conjunction: true, positive: mergeData(crossPositive, clause.positive), negative: mergeData(crossNegative, clause.negative) }));
  }

  return createClause({
    conjunction: false,
    positive: overlap[side].clause.positive,
    negative: overlap[side].clause.negative,
    clauses: finalClauses,
  });
}

// TODO: it's impossible for this function to generate a clause that is bigger than the sum of its parents
// TODO: assumes removeClause in the relevant side has no value
export function applyTripleClauseOverlap(overlap: ClauseOverlap, left: boolean): Clause {
  const side = left ? 'left' : 'right';
  const otherSide = left ? 'right' : 'left';
  if (overlap[side].removeClause) {
    throw new Error('This function should not be called if `removeClause` is not defined for this side.');
  }

  // The remaining triples of the initial clause
  const positive = mergeData(overlap[side].clause.positive);
  const negative = mergeData(overlap[side].clause.negative);
  removeQuad(((overlap.leftPositive === left) ? positive : negative), overlap[side].remove);

  // The remaining triples/clauses of the other clause
  const otherPositive = mergeData(overlap[otherSide].clause.positive);
  const otherNegative = mergeData(overlap[otherSide].clause.negative);
  if (!overlap[otherSide].removeClause) {
    removeQuad(((overlap.leftPositive === left) ? otherNegative : otherPositive), overlap[otherSide].remove);
  }

  // The combined clauses of both sides
  const clauses: Clause[] = [
    ...overlap[side].clause.clauses,
    ...(overlap[otherSide].removeClause ?
      overlap[otherSide].clause.clauses.filter((child): boolean => child !== overlap[otherSide].removeClause) :
      overlap[otherSide].clause.clauses),
  ];

  // Generate the triples that will be in the new clause.
  // Note that we first keep them separate above in case one side would happen to have the triple that would be removed in the other.
  const mergedPositive = mergeData(positive, otherPositive);
  const mergedNegative = mergeData(negative, otherNegative);

  const result = createClause({
    conjunction: false,
    positive: applyBindingsToQuads(mergedPositive, overlap.binding) ?? mergedPositive,
    negative: applyBindingsToQuads(mergedNegative, overlap.binding) ?? mergedNegative,
    clauses,
  });
  // TODO: doing this after merge might be bad I think, need to find example though
  // TODO: it's possible that the removeClause contains even more information about things that can be removed
  //       e.g., A || B and (-A && -B) || C. Standard solution would be to generate B || C, but actually this can be simplified to C
  //       what about (A && D) || B? -> same thing, result is still C
  const removeClause = overlap[otherSide].removeClause;
  if (removeClause) {
    for (const quad of applyBindingsToQuads(removeClause.positive, overlap.binding) ?? removeClause.positive) {
      removeQuad(result.negative, quad);
    }
    for (const quad of applyBindingsToQuads(removeClause.negative, overlap.binding) ?? removeClause.negative) {
      removeQuad(result.positive, quad);
    }
  }

  return result;
}

export function removeQuad(quads: Quad[], quad: Quad): void {
  quads.splice(quads.indexOf(quad), 1);
}

// TODO: by stopping at the first hit we might miss other options (especially if we compare clause subsets)
//       could yield, probably more duplication and will need to change how we do caching potentially

// TODO: assuming level 1 clauses here
export function getClauseOverlap(left: Clause, right: Clause, quantifiers: Record<string, number>): ClauseOverlap | undefined {
  // Check for overlap with all left triples/clauses and right triples/clauses
  for (const side of [ 'positive', 'negative', 'clauses' ] as const) {
    const otherSide = side === 'positive' ? 'negative' : 'positive';
    for (const leftQuad of left[side]) {
      for (const rightQuad of right[otherSide]) {
        const overlap = findQuadOverlap({ clause: left, value: leftQuad }, { clause: right, value: rightQuad }, side === 'positive', quantifiers);
        if (overlap) {
          return overlap;
        }
      }

      // `otherSide` is "positive" if `side` is "clauses", so here we also compare with the negative ones
      if (side === 'clauses') {
        for (const rightQuad of right.negative) {
          // `leftPositive` value is irrelevant here
          const overlap = findQuadOverlap({ clause: left, value: leftQuad }, { clause: right, value: rightQuad }, true, quantifiers);
          if (overlap) {
            return overlap;
          }
        }
      }

      for (const rightClause of right.clauses) {
        const overlap = findQuadOverlap({ clause: left, value: leftQuad }, { clause: right, value: rightClause }, side === 'positive', quantifiers);
        if (overlap) {
          return overlap;
        }
      }
    }
  }
}

export function findQuadOverlap(left: { clause: Clause; value: Clause | Quad }, right: { clause: Clause; value: Clause | Quad }, leftPositive: boolean, quantifiers: Record<string, number>): ClauseOverlap | undefined {
  if (isClause(left.value)) {
    for (const side of [ 'positive', 'negative' ] as const) {
      for (const leftQuad of left.value[side]) {
        const overlap = findQuadOverlap({ clause: left.clause, value: leftQuad }, right, side === 'positive', quantifiers);
        if (overlap) {
          overlap.left.removeClause = left.value;
          return overlap;
        }
      }
    }
    return;
  }

  // Left is a quad
  if (isClause(right.value)) {
    for (const rightQuad of right.value[ leftPositive ? 'negative' : 'positive' ]) {
      const overlap = findQuadOverlap(left, { clause: right.clause, value: rightQuad }, leftPositive, quantifiers);
      if (overlap) {
        overlap.right.removeClause = right.value;
        return overlap;
      }
    }
    return;
  }

  // Both are quads
  const binding = getOverlapBinding(left.value, right.value, quantifiers);
  if (binding) {
    return {
      left: { clause: left.clause, remove: left.value },
      right: { clause: right.clause, remove: right.value },
      leftPositive,
      binding,
    };
  }
}

// TODO: is it possible this returns conflicting bindings for the same clauses?
//       -> not a problem but only use those that do not conflict though
export function getOverlapBinding(left: Quad, right: Quad, quantifiers: Record<string, number>): Record<string, Term> | undefined {
  let bindings: Record<string, Term> = {};
  for (const pos of QUAD_POSITIONS) {
    const leftTerm = left[pos];
    const rightTerm = right[pos];
    if (isUniversal(leftTerm, quantifiers)) {
      bindings[leftTerm.value] = rightTerm;
    } else if (isUniversal(rightTerm, quantifiers)) {
      bindings[rightTerm.value] = leftTerm;
    } else if (!leftTerm.equals(rightTerm)) {
      return;
    }
  }
  return bindings;
}

export function isClause(value: Clause | Quad): value is Clause {
  return value.hasOwnProperty('clauses');
}

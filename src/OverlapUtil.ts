import { Quad, Term } from '@rdfjs/types';
import { applyBindingsToStore } from './BindUtil';
import { Clause, mergeData, RootClause } from './ClauseUtil';
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
  let result: Clause[] = [];
  if (!overlap.left.removeClause && !overlap.right.removeClause) {
    result = [ applyPartialClauseOverlap(overlap, true) ];
  } else {
    result = [applyPartialClauseOverlap(overlap, true), applyPartialClauseOverlap(overlap, false)];
  }
  for (const clause of result) {
    logger.debug(`generated ${stringifyClause(clause)} from ${stringifyClause(overlap.left.clause)} and ${stringifyClause(overlap.right.clause)}`);
  }
  return result;
}

// Determines the overlap by inserting into 1 side
export function applyPartialClauseOverlap(overlap: ClauseOverlap, left: boolean): Clause {
  if (overlap[left ? 'left' : 'right'].removeClause) {
    return applySubClauseOverlap(overlap, left);
  } else {
    return applyTripleClauseOverlap(overlap, left);
  }
}

// TODO: assumes removeClause in the relevant side has a value
function applySubClauseOverlap(overlap: ClauseOverlap, left: boolean): Clause {
  const side = left ? 'left' : 'right';
  const otherSide = left ? 'right' : 'left';
  const removeClause = overlap[side].removeClause;
  if (!removeClause) {
    throw new Error('This function should not be called if `removeClause` is not defined for this side.');
  }

  // In the clause where we replace a triple: the triples that have to remain.
  const crossPositive = mergeData(removeClause.positive);
  const crossNegative = mergeData(removeClause.negative);
  ((overlap.leftPositive === left) ? crossPositive : crossNegative).removeQuad(overlap[side].remove);

  // In the clause that will be used as injection: the parts that are not removed.
  const otherPositive = mergeData(overlap[otherSide].clause.positive);
  const otherNegative = mergeData(overlap[otherSide].clause.negative);
  const otherClauses: Clause[] = [
    ...(overlap[otherSide].removeClause ? overlap[otherSide].clause.clauses.filter((child): boolean => child !== overlap[otherSide].removeClause) : overlap[otherSide].clause.clauses),
  ];
  if (!overlap[otherSide].removeClause) {
    ((overlap.leftPositive === left) ? otherNegative : otherPositive).removeQuad(overlap[otherSide].remove);
  }

  // For every part remaining in the "other" disjunction: create a new disjunction entry and then combine these with the remaining parts of the initial disjunction
  const finalClauses: Clause[] = overlap[side].clause.clauses.filter((clause): boolean => clause !== removeClause);
  for (const quad of otherPositive) {
    finalClauses.push({ conjunction: true, positive: mergeData(quad, crossPositive), negative: crossNegative, clauses: [] });
  }
  for (const quad of otherNegative) {
    finalClauses.push({ conjunction: true, positive: crossPositive, negative: mergeData(quad, crossNegative), clauses: [] });
  }
  for (const clause of otherClauses) {
    finalClauses.push({ conjunction: true, positive: mergeData(crossPositive, clause.positive), negative: mergeData(crossNegative, clause.negative), clauses: [] });
  }

  return {
    conjunction: false,
    positive: overlap[side].clause.positive,
    negative: overlap[side].clause.negative,
    clauses: finalClauses,
  };
}

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
  ((overlap.leftPositive === left) ? positive : negative).removeQuad(overlap[side].remove);

  // The remaining triples/clauses of the other clause
  const otherPositive = mergeData(overlap[otherSide].clause.positive);
  const otherNegative = mergeData(overlap[otherSide].clause.negative);
  if (!overlap[otherSide].removeClause) {
    ((overlap.leftPositive === left) ? otherNegative : otherPositive).removeQuad(overlap[otherSide].remove);
  }

  // The combined clauses of both sides
  const clauses: Clause[] = [
    ...overlap[side].clause.clauses,
    ...(overlap[otherSide].removeClause ? overlap[otherSide].clause.clauses.filter((child): boolean => child !== overlap[otherSide].removeClause) : overlap[otherSide].clause.clauses),
  ];

  // Generate the triples that will be in the new clause.
  // Note that we first keep them separate above in case one side would happen to have the triple that would be removed in the other.
  const mergedPositive = mergeData(positive, otherPositive);
  const mergedNegative = mergeData(negative, otherNegative);

  return {
    conjunction: false,
    positive: applyBindingsToStore(mergedPositive, overlap.binding) ?? mergedPositive,
    negative: applyBindingsToStore(mergedNegative, overlap.binding) ?? mergedNegative,
    clauses,
  }
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
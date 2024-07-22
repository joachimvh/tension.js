import type { BuiltinCallOptions } from './BuiltinUtil';
import { handleBuiltinCheck } from './BuiltinUtil';
import type { Clause, RootClause } from './ClauseUtil';
import { createClause, negateType, POSITIVE_NEGATIVE } from './ClauseUtil';
import {
  equalOrExistential,
  equalOrUniversal,
  fancyEquals,
  impliesQuad,
} from './FancyUtil';
import { getLogger } from './LogUtil';
import { stringifyClause, stringifyQuad } from './ParseUtil';

// TODO: level 0: root, level 1: disjunctions, level 2: leaf conjunctions

// TODO: somehow want this to yield the new results

const logger = getLogger('Simplify');

export function simplifyRoot(root: RootClause): boolean {
  let change = false;
  // Simplify the child clauses
  const removeClauseIdx = new Set<number>();
  for (const [ idx, child ] of root.clauses.entries()) {
    const simplified = simplifyLevel1(root, child);
    change = change || Boolean(simplified);

    if (simplified) {
      logger.debug(`Simplified ${stringifyClause(child)} to ${
        typeof simplified === 'boolean' ? simplified : stringifyClause(simplified)}`);
    }

    if (simplified === true) {
      removeClauseIdx.add(idx);
    } else if (simplified?.conjunction) {
      removeClauseIdx.add(idx);
      handleConjunctionResult(root, simplified);
    } else if (simplified) {
      root.clauses[idx] = simplified;
    }
  }
  if (removeClauseIdx.size > 0) {
    root.clauses = root.clauses.filter((child, idx): boolean => !removeClauseIdx.has(idx));
    change = true;
  }

  // A contradiction in root means no useful information can be deduced
  for (const positive of root.positive) {
    for (const negative of root.negative) {
      if (equalOrUniversal(positive, negative, root.quantifiers)) {
        throw new Error('Found a contradiction at root level, stopping execution.');
      }
    }
  }

  return change;
}

// Adds the triples of a conjunction directly to the root.
export function handleConjunctionResult(root: RootClause, conjunction: Clause): void {
  for (const side of POSITIVE_NEGATIVE) {
    for (const quad of conjunction[side]) {
      logger.info(`Deduced ${stringifyQuad(quad, side === 'positive')}`);
      root[side].push(quad);
    }
  }
}

export function simplifyLevel1(root: RootClause, clause: Clause): Clause | true | undefined {
  // Simplify the conjunctions first
  const result = simplifyLevel1Children(root, clause);
  if (result === true) {
    return true;
  }

  // Remove conjunctions that are a superset of other conjunctions/triples
  removeLevel1Supersets(result);

  // Remove duplicate triples/triples known to be false,
  // if a value returns true this means the entire disjunction is true
  if (removeSuperfluousTriples(root, result) === true) {
    return true;
  }

  const value = evaluateClause(root, result);
  if (typeof value === 'boolean') {
    if (value) {
      logger.debug(`${stringifyClause(clause)} is a tautology so can be ignored`);
      return true;
    }
    // We have removed all false values, so nothing true is left
    throw new Error(`Found a contradiction at root level, stopping execution. Caused by simplifying ${
      stringifyClause(clause)}`);
  }

  // Check if this clause can be reduced to a single conjunction
  const simplifiedQuads = clauseToTriples(clause);
  if (simplifiedQuads) {
    return simplifiedQuads;
  }

  // Nothing was changed or could be deduced
  if (result.positive === clause.positive && result.negative === clause.negative && result.clauses === clause.clauses) {
    return;
  }

  return result;
}

export function simplifyLevel2(root: RootClause, clause: Clause): Clause | boolean | undefined {
  const result = createClause(clause);

  // Remove duplicate triples/triples known to be true,
  //   // if a value returns false this means the entire conjunction is false
  if (removeSuperfluousTriples(root, result) === false) {
    return false;
  }

  // Either a contradiction or all true values have been removed meaning the entire conjunction is true
  const value = evaluateClause(root, result);
  if (typeof value === 'boolean') {
    if (!value) {
      logger.debug(`${stringifyClause(clause)} is a contradiction so can be removed`);
    }
    return value;
  }

  // Nothing changed
  if (result.positive === clause.positive && result.negative === clause.negative) {
    return;
  }

  return result;
}

// TODO: input can be the original clause, will generate new clause
export function simplifyLevel1Children(root: RootClause, clause: Clause): Clause | true {
  const partial: Partial<Clause> = {};

  // Simplify the child clauses
  const removeClauseIdx = new Set<number>();
  for (const [ idx, child ] of clause.clauses.entries()) {
    const simplified = simplifyLevel2(root, child);
    if (simplified === undefined) {
      continue;
    }

    if (simplified === true) {
      return true;
    }
    if (simplified === false) {
      removeClauseIdx.add(idx);
    } else {
      partial.clauses = partial.clauses ?? [ ...clause.clauses ];
      partial.clauses[idx] = simplified;
      // Remove single triple clauses and put them directly into relevant store
      if (simplified.positive.length + simplified.negative.length === 1) {
        removeClauseIdx.add(idx);
        const side = simplified.positive.length === 1 ? 'positive' : 'negative';
        partial[side] = partial[side] ?? [ ...clause[side] ];
        partial[side].push(simplified[side][0]);
      }
    }
  }
  if (removeClauseIdx.size > 0) {
    partial.clauses = partial.clauses ?? [ ...clause.clauses ];
    partial.clauses = partial.clauses.filter((child, idx): boolean => !removeClauseIdx.has(idx));
  }
  return createClause({ ...clause, ...partial });
}

// TODO: input should be the new intermediate clause
export function removeLevel1Supersets(clause: Clause): void {
  // A || (A && B) implies A
  // Need to make sure we use the new clauses array if there is one
  const removeClauseIdx = new Set<number>();
  for (const [ idx, child ] of clause.clauses.entries()) {
    // Needs to happen after previous block, so we still find contradictions
    if (hasDisjunctionSubset(child, clause)) {
      removeClauseIdx.add(idx);
    }
  }
  if (removeClauseIdx.size > 0) {
    clause.clauses = clause.clauses.filter((child, idx): boolean => !removeClauseIdx.has(idx));
  }
}

export enum BuiltinCheckRemove {
  quad = 'quad',
  clause = 'clause',
}

export function builtinCheck(options: BuiltinCallOptions, positive: boolean): BuiltinCheckRemove | undefined {
  const builtinResult = handleBuiltinCheck(options);
  if (builtinResult === undefined) {
    return;
  }
  const signedBuiltinResult = builtinResult === positive;
  if (options.clause.conjunction === signedBuiltinResult) {
    logger.debug(`Builtin ${stringifyQuad(options.quad, positive)} is ${
      signedBuiltinResult} so can be removed from ${stringifyClause(options.clause)}`);
    return BuiltinCheckRemove.quad;
  }

  logger.debug(`Builtin ${stringifyQuad(options.quad, positive)} is ${
    signedBuiltinResult} so ${stringifyClause(options.clause)} can be removed`);
  return BuiltinCheckRemove.clause;
}

// TODO: input should be the new intermediate clause
export function removeSuperfluousTriples(root: RootClause, clause: Clause): boolean | Clause {
  // Remove duplicate and false triples
  for (const side of POSITIVE_NEGATIVE) {
    const removeIdx = new Set<number>();
    for (const [ idxA, quad ] of clause[side].entries()) {
      // Check builtins
      const builtinResult = builtinCheck({ root, clause, quad }, side === 'positive');
      if (builtinResult === BuiltinCheckRemove.clause) {
        return !clause.conjunction;
      }
      if (builtinResult === BuiltinCheckRemove.quad) {
        removeIdx.add(idxA);
      }
    }
    if (removeIdx.size > 0) {
      clause[side] = clause[side].filter((quad, idx): boolean => !removeIdx.has(idx));
    }
  }

  for (const side of POSITIVE_NEGATIVE) {
    // Remove duplicate and false values
    const removeIdx = findSuperfluousTriples(root, clause, side === 'positive');
    if (removeIdx.size > 0) {
      clause[side] = clause[side].filter((quad, idx): boolean => !removeIdx.has(idx));
    }
  }

  return clause;
}

export function findSuperfluousTriples(root: RootClause, clause: Clause, positive: boolean): Set<number> {
  const removeIdx = new Set<number>();
  const side = positive ? 'positive' : 'negative';

  for (const [ idxA, quadA ] of clause[side].entries()) {
    for (const [ idxB, quadB ] of clause[side].entries()) {
      // TODO: this prevents removing both B in A || B || B
      if (idxA === idxB || removeIdx.has(idxB)) {
        continue;
      }
      // TODO: `impliesQuad` can give wrong results for disjunctions since \forall x,y: f(x) | f(y) | h(y)
      //       does not imply \forall x,y: f(x) | h(y)
      // TODO: need to also take into account that \forall x: f(x) | f(A) does not imply \forall x: f(x)!
      //       it could be that only f(A) is true for all values
      //       \forall x: f(x) | g(x) | f(A) also does not imply \forall x: g(x) | f(A)!
      if ((clause.conjunction ? impliesQuad : fancyEquals)(quadB, quadA, root.quantifiers)) {
        logger.debug(`${stringifyQuad(quadB, positive)} implies ${
          stringifyQuad(quadA, positive)} can be removed from ${stringifyClause(clause)}`);
        removeIdx.add(idxA);
        break;
      }
    }
  }

  for (const [ idx, quad ] of clause[side].entries()) {
    if (removeIdx.has(idx)) {
      continue;
    }
    const rootPositive = clause.conjunction === positive;
    const rootQuads = root[rootPositive ? 'positive' : 'negative'];
    for (const rootQuad of rootQuads) {
      if (impliesQuad(rootQuad, quad, root.quantifiers)) {
        logger.debug(`${stringifyQuad(rootQuad, rootPositive)} is known so ${
          stringifyQuad(quad, positive)} can be removed from ${stringifyClause(clause)}`);
        removeIdx.add(idx);
        break;
      }
    }
  }
  // TODO: might as well remove them at this point...

  return removeIdx;
}

// TODO: Used to help simplify (A && B) || (A && B && C) to A && B
export function hasDisjunctionSubset(clause: Clause, parent: Clause): boolean {
  for (const quad of clause.positive) {
    if (parent.positive.some((parentQuad): boolean => fancyEquals(quad, parentQuad))) {
      logger.debug(`${stringifyQuad(quad)} implies ${
        stringifyClause(clause)} can be removed from disjunction (disjunction subset)`);
      return true;
    }
  }
  for (const quad of clause.negative) {
    if (parent.negative.some((parentQuad): boolean => fancyEquals(quad, parentQuad))) {
      logger.debug(`${stringifyQuad(quad, false)} implies ${
        stringifyClause(clause)} can be removed from disjunction (disjunction subset)`);
      return true;
    }
  }
  for (const conj of parent.clauses) {
    if (conj === clause) {
      continue;
    }
    let match = true;
    for (const quad of conj.positive) {
      if (!clause.positive.some((clauseQuad): boolean => fancyEquals(quad, clauseQuad))) {
        match = false;
        break;
      }
    }
    if (match) {
      for (const quad of conj.negative) {
        if (!clause.negative.some((clauseQuad): boolean => fancyEquals(quad, clauseQuad))) {
          match = false;
          break;
        }
      }
    }
    if (match) {
      logger.debug(`${stringifyClause(conj)} implies ${
        stringifyClause(clause)} can be removed from disjunction (disjunction subset)`);
      return true;
    }
  }
  return false;
}

// TODO: level 1
//       A || -A
//       \exists x: f(x) || -(A)
//       A || -B if either A or -B is known at root
// TODO: level 2
//   A && -A
//   \forall x: f(x) && -f(A)
//   A && -B if either -A or B are known at root
export function evaluateClause(root: RootClause, clause: Clause): boolean | undefined {
  // We have removed all values, so result is true/false (depending on conjunction/disjunction)
  if (clause.clauses.length === 0 && clause.positive.length === 0 && clause.negative.length === 0) {
    return clause.conjunction;
  }

  for (const positive of clause.positive) {
    for (const negative of clause.negative) {
      if ((clause.conjunction ? equalOrUniversal : equalOrExistential)(positive, negative, root.quantifiers)) {
        return !clause.conjunction;
      }
    }
  }

  // In conjunctions, we want to find quads that are the opposite of root quads, implying the conjunction is false
  // In disjunctions, we want the same sign as that implies the disjunction is true
  for (const side of POSITIVE_NEGATIVE) {
    for (const rootQuad of root[side]) {
      for (const quad of clause.conjunction ? clause[negateType(side)] : clause[side]) {
        if (impliesQuad(rootQuad, quad, root.quantifiers)) {
          return !clause.conjunction;
        }
      }
    }
  }
}

// Returns a conjunction if there is a valid result
export function clauseToTriples(clause: Clause): Clause | undefined {
  if (clause.conjunction) {
    return clause;
  }
  // Let's just assume we don't have empty clauses here
  if (clause.positive.length + clause.negative.length + clause.clauses.length > 1) {
    return;
  }
  if (clause.positive.length === 1 || clause.negative.length === 1) {
    return { ...clause, conjunction: true };
  }
  return clause.clauses[0];
}

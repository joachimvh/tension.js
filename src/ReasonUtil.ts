import { inspect } from 'node:util';
import type { BindCache } from './BindUtil';
import { applyBinding, findBindings } from './BindUtil';
import type { BuiltinCache } from './BuiltinUtil';
import { generateBuiltinResultClauses } from './BuiltinUtil';
import type { Clause, RootClause } from './ClauseUtil';
import { isDisjunctionSubset } from './ClauseUtil';
import { fancyEquals } from './FancyUtil';
import { getLogger } from './LogUtil';
import type { OverlapCache } from './OverlapUtil';
import { applyClauseOverlap, findOverlappingClause } from './OverlapUtil';
import { stringifyClause, stringifyQuad } from './ParseUtil';
import { handleConjunctionResult, simplifyLevel1, simplifyLevel2, simplifyRoot } from './SimplifyUtil';

const logger = getLogger('Reason');

export type ReasonCaches = {
  builtinCache: BuiltinCache;
  bindingCache: BindCache;
  overlapCache: OverlapCache;
};

export function reason(root: RootClause, answerClauses: Clause[], maxSteps = 5): void {
  const cache: ReasonCaches = {
    builtinCache: new WeakSet(),
    bindingCache: {
      clauses: new WeakSet(),
      quads: new WeakSet(),
      bindings: [],
    },
    overlapCache: new WeakMap(),
  };
  let count = 0;

  while ((maxSteps <= 0 ? true : count < maxSteps) && reasonStep(root, answerClauses, cache)) {
    count += 1;
    logger.debug(`COMPLETED STEP ${count}`);
  }
  logger.debug('FINISHED');
}

export function reasonStep(root: RootClause, answerClauses: Clause[], caches: ReasonCaches): boolean {
  let change = false;
  while (simplifyRoot(root)) {
    logger.debug(`Simplified root to ${stringifyClause(root)}`);
    change = true;
  }
  if (isAnswered(root, answerClauses)) {
    logger.debug('Stopping as answer has been reached.');
    return false;
  }

  let newClauses: Clause[] = [];
  const removeSet = new Set<number>();
  for (const { idx, clause: builtinClause } of generateBuiltinResultClauses(root, caches.builtinCache)) {
    change = handleNewClause(root, builtinClause, newClauses) || change;
    removeSet.add(idx);
  }
  if (removeSet.size > 0) {
    root.clauses = root.clauses.filter((child, idx): boolean => !removeSet.has(idx));
  }
  root.clauses.push(...newClauses);

  for (const binding of findBindings(root, caches.bindingCache)) {
    newClauses = [];
    logger.debug(`Applying binding ${inspect(binding)}`);
    for (const clause of root.clauses) {
      const bound = applyBinding(clause, binding);
      if (bound) {
        change = handleNewClause(root, bound, newClauses) || change;
      }
    }
    // Pushing every iteration here so next bindings are applied to results generated here.
    // Can not wait for next step because of binding cache, alternative would be to not have that cache.
    root.clauses.push(...newClauses);

    // TODO: better way to check if a quad should be checked (per quad list of blank nodes in it?)
    for (const side of [ 'positive', 'negative' ] as const) {
      for (const quad of root[side]) {
        const boundQuad = applyBinding(quad, binding);
        if (boundQuad && !root[side].some((oldQuad): boolean => fancyEquals(boundQuad, oldQuad))) {
          root[side].push(boundQuad);
          logger.info(`Deduced ${stringifyQuad(boundQuad, side === 'negative')}`);
        }
      }
    }
  }

  while (simplifyRoot(root)) {
    logger.debug(`Simplified root to ${stringifyClause(root)}`);
    change = true;
  }
  if (isAnswered(root, answerClauses)) {
    logger.debug('Stopping as answer has been reached.');
    return false;
  }

  newClauses = [];
  for (const overlap of findOverlappingClause(root, caches.overlapCache)) {
    const overlapClauses = applyClauseOverlap(overlap);
    const leftCount = countQuads(overlap.left.clause);
    const rightCount = countQuads(overlap.right.clause);
    for (const clause of overlapClauses) {
      // I spent an hour debugging why this didn't work because I first had `change = change || handleNewClause...`
      change = handleNewClause(root, clause, newClauses, (simplified): boolean =>
        leftCount + rightCount > countQuads(simplified)) || change;
    }
  }
  root.clauses.push(...newClauses);

  return change;
}

// TODO: this does not yet support more complex answer clauses where we need to check bindings
export function isAnswered(root: RootClause, answerClauses: Clause[]): boolean {
  for (const clause of answerClauses) {
    const result = clause.conjunction ? simplifyLevel2(root, clause) : simplifyLevel1(root, clause);
    if (result === true) {
      return true;
    }
  }
  return false;
}

export function handleNewClause(
  root: RootClause,
  clause: Clause,
  newClauses: Clause[],
  additionalCheck?: (simplified: Clause) => boolean,
): boolean {
  const simplified = simplifyLevel1(root, clause) ?? clause;
  if (simplified === true) {
    return false;
  }
  if (simplified.conjunction) {
    handleConjunctionResult(root, simplified);
    return true;
  }
  if (additionalCheck && !additionalCheck(simplified)) {
    return false;
  }

  if (root.clauses.some((child): boolean => isDisjunctionSubset(child, simplified, root.quantifiers)) ||
    newClauses.some((child): boolean => isDisjunctionSubset(child, simplified, root.quantifiers))) {
    return false;
  }
  logger.debug(`Storing new clause: ${stringifyClause(simplified)}`);
  newClauses.push(simplified);
  return true;
}

export function countQuads(clause: Clause): number {
  return clause.positive.length +
    clause.negative.length +
    clause.clauses.map(countQuads).reduce((sum, val): number => sum + val, 0);
}

import type { BindCache } from './BindUtil';
import { applyBinding, findBindResults } from './BindUtil';
import type { BuiltinCache } from './BuiltinUtil';
import { generateBuiltinResultClauses } from './BuiltinUtil';
import type { Clause, RootClause } from './ClauseUtil';
import { isDisjunctionSubset, POSITIVE_NEGATIVE } from './ClauseUtil';
import type { FancyQuad } from './FancyUtil';
import { getLogger } from './LogUtil';
import type { OverlapCache } from './OverlapUtil';
import { applyClauseOverlap, findOverlappingClause } from './OverlapUtil';
import { stringifyClause } from './ParseUtil';
import { handleConjunctionResult, simplifyLevel1, simplifyLevel2, simplifyRoot } from './SimplifyUtil';

const logger = getLogger('Reason');

export type ReasonCaches = {
  builtinCache: BuiltinCache;
  bindingCache: BindCache;
  overlapCache: OverlapCache;
};

export type QuadResult = {
  type: 'Quad';
  value: FancyQuad;
  positive: boolean;
};

export type ReasonResult = QuadResult;

export function* reason(root: RootClause, answerClauses: Clause[], maxSteps = 5): IterableIterator<ReasonResult> {
  const cache: ReasonCaches = {
    builtinCache: new WeakSet(),
    bindingCache: {
      clauses: new WeakSet(),
      quads: new WeakSet(),
    },
    overlapCache: new WeakMap(),
  };
  let count = 0;

  // TODO: should do refactors so we can just yield results from the functions directly instead of doing this
  const resultQuads = new Set<FancyQuad>();
  yield* yieldQuads(root, resultQuads);

  while ((maxSteps <= 0 ? true : count < maxSteps) && reasonStep(root, answerClauses, cache)) {
    yield* yieldQuads(root, resultQuads);
    count += 1;
    logger.debug(`COMPLETED STEP ${count}`);
  }
  yield* yieldQuads(root, resultQuads);
  logger.debug('FINISHED');
}

export function* yieldQuads(root: RootClause, resultQuads: Set<FancyQuad>): IterableIterator<ReasonResult> {
  for (const side of POSITIVE_NEGATIVE) {
    for (const quad of root[side]) {
      if (resultQuads.has(quad)) {
        continue;
      }
      yield { type: 'Quad', value: quad, positive: side === 'positive' };
      resultQuads.add(quad);
    }
  }
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

  // TODO: need way to also find potential bindings on root quads containing universals
  newClauses = [];
  for (const { binding, clause } of findBindResults(root, caches.bindingCache)) {
    const bound = applyBinding(clause, binding);
    if (bound) {
      logger.debug(`generated ${stringifyClause(bound)} by applying ${JSON.stringify(binding)}`);
      change = handleNewClause(root, bound, newClauses) || change;
    }
  }
  root.clauses.push(...newClauses);

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

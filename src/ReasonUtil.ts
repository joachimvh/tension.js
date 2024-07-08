import { Quad, Term } from '@rdfjs/types';
import { inspect } from 'node:util';
import { applyBindings, findBindings } from './BindUtil';
import { Clause, isDisjunctionSubset, RootClause } from './ClauseUtil';
import { getLogger } from './LogUtil';
import { applyClauseOverlap, ClauseOverlap, findOverlappingClause } from './OverlapUtil';
import { stringifyClause } from './ParseUtil';
import { simplifyLevel1, simplifyLevel2, simplifyRoot } from './SimplifyUtil';

const logger = getLogger('Reason');

export enum ReasonResultType {
  PositiveTriple,
  NegativeTriple,
  Clause,
}

export type PositiveTripleResult = {
  type: ReasonResultType.PositiveTriple,
  value: Quad,
};

export type NegativeTripleResult = {
  type: ReasonResultType.NegativeTriple,
  value: Quad,
};

export type ClauseResult = {
  type: ReasonResultType.Clause,
  value: Clause,
};

export type ReasonResult = PositiveTripleResult | NegativeTripleResult | ClauseResult;

export function reason(root: RootClause, answerClause?: Clause, maxSteps = 5): void {
  const bindingCache: Record<string, Term>[] = [];
  const overlapCache: ClauseOverlap[] = [];
  let count = 0;
  while ((count < maxSteps || maxSteps <= 0) && reasonStep(root, bindingCache, overlapCache)) {
    ++count;
    logger.debug(`COMPLETED STEP ${count}`);
    if (answerClause) {
      let simplified = answerClause.conjunction ? simplifyLevel2(root, answerClause) : simplifyLevel1(root, answerClause);
      if (simplified === true) {
        logger.debug('Stopping as answer has been reached.');
        break;
      }
    }
  }
  logger.debug('FINISHED');
}

export function reasonStep(root: RootClause, bindingCache: Record<string, Term>[], overlapCache: ClauseOverlap[]): boolean {
  let change = false;
  while (simplifyRoot(root)) {
    logger.debug(`Simplified root to ${stringifyClause(root)}`);
    change = true;
  }
  
  for (const binding of findBindings(root)) {
    let newClauses: Clause[] = [];
    if (bindingCache.some((cached): boolean => isSameBinding(binding, cached))) {
      continue;
    }
    logger.debug(`Applying binding ${inspect(binding)}`);
    bindingCache.push(binding);
    change = true;
    for (const clause of root.clauses) {
      const bound = applyBindings(clause, binding);
      if (bound){
        const simplified = simplifyLevel1(root, bound) ?? bound;
        if (simplified === true) {
          continue;
        }
        if (root.clauses.some((child): boolean => isDisjunctionSubset(child, simplified, root.quantifiers)) 
          || newClauses.some((child): boolean => isDisjunctionSubset(child, simplified, root.quantifiers))) {
          continue;
        }
        logger.debug(`Storing new bound clause: ${stringifyClause(simplified)}`);
        newClauses.push(simplified);
      }
    }
    // Pushing every iteration here so next bindings are applied to results generated here.
    // Can not wait for next step because of binding cache, alternative would be to not have that cache.
    root.clauses.push(...newClauses);
  }
  
  while (simplifyRoot(root)) {
    logger.debug(`Simplified root to ${stringifyClause(root)}`);
    change = true;
  }

  let newClauses: Clause[] = [];
  for (const overlap of findOverlappingClause(root)) {
    if (overlapCache.some((cached): boolean => isSameOverlap(overlap, cached))) {
      continue;
    }
    overlapCache.push(overlap);
    const overlapClauses = applyClauseOverlap(overlap);
    const leftCount = countQuads(overlap.left.clause);
    const rightCount = countQuads(overlap.right.clause);
    for (const clause of overlapClauses) {
      const simplified = simplifyLevel1(root, clause) ?? clause;
      if (simplified === true) {
        continue;
      }
      // TODO: want to do this after simplifying
      const overlapCount = countQuads(simplified);
      if (leftCount + rightCount < overlapCount) {
        continue;
      }
      if (root.clauses.some((child): boolean => isDisjunctionSubset(child, simplified, root.quantifiers))
        || newClauses.some((child): boolean => isDisjunctionSubset(child, simplified, root.quantifiers))) {
        continue;
      }
      logger.debug(`Storing new overlap clause: ${stringifyClause(simplified)}`);
      newClauses.push(simplified);
      change = true;
    }
  }
  root.clauses.push(...newClauses);
  
  return change;
}

export function isSameBinding(left: Record<string, Term>, right: Record<string, Term>): boolean {
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
    if (!left[key].equals(right[key])) {
      return false;
    }
  }
  return true;
}

export function isSameOverlap(left: ClauseOverlap, right: ClauseOverlap): boolean {
  return isSameBinding(left.binding, right.binding) &&
    left.leftPositive === right.leftPositive &&
    left.left.clause === right.left.clause &&
    left.left.remove.equals(right.left.remove) &&
    left.right.clause === right.right.clause &&
    right.right.remove.equals(right.right.remove);
}

export function countQuads(clause: Clause): number {
  return clause.positive.size + clause.negative.size + clause.clauses.map(countQuads).reduce((sum, val): number => sum + val, 0);
}
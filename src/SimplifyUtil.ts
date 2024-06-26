import { BlankNode, Quad, Term } from '@rdfjs/types';
import { Store } from 'n3';
import { Clause, getQuads, mergeData, RootClause } from './ClauseUtil';
import { getLogger } from './LogUtil';
import { QUAD_POSITIONS, stringifyClause, stringifyQuad } from './ParseUtil';

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
      logger.debug(`Simplified ${stringifyClause(child)} to ${typeof simplified === 'boolean' ? simplified : stringifyClause(simplified)}`);
    }
    
    if (simplified === true) {
      removeClauseIdx.add(idx);
    } else {
      // These steps could also happen if the clause was not simplified.
      // For example if the clause was newly generated in a previous step.
      const clause = simplified ?? child;
      root.clauses[idx] = clause;
      // Remove single triple clauses and put them directly into relevant store
      const simplifiedQuads = clauseToTriples(clause);
      if (simplifiedQuads) {
        removeClauseIdx.add(idx);
        change = true;
        for (const { quad, positive } of simplifiedQuads) {
          logger.info(`Deduced ${stringifyQuad(quad, !positive)}`);
          root[positive ? 'positive' : 'negative'].addQuad(quad);
        }
      }
    }
  }
  if (removeClauseIdx.size > 0) {
    root.clauses = root.clauses.filter((child, idx): boolean => !removeClauseIdx.has(idx));
    change = true;
  }
  
  // A contradiction in root means no useful information can be deduced
  // TODO: this is not a good function to call for root though as it will do double work, on the other hand, usually not that many quads in root
  if (isContradiction(root, root)) {
    throw new Error('Found a contradiction at root level, stopping execution.');
  }
  
  return change;
}

export function simplifyLevel1(root: RootClause, clause: Clause): Clause | true | undefined {
  const quads: { positive: Store | undefined; negative: Store | undefined } = { positive: undefined, negative: undefined };
  let clauses: Clause[] | undefined;
  
  // Simplify the child clauses
  const removeClauseIdx = new Set<number>();
  for (const [ idx, child ] of clause.clauses.entries()) {
    const simplified = simplifyLevel2(root, child);
    if (simplified === undefined) {
      continue;
    }
    
    if (simplified === true) {
      return true;
    } else if (simplified === false) {
      removeClauseIdx.add(idx);
    } else {
      clauses = clauses || [ ...clause.clauses ];
      clauses[idx] = simplified;
      // Remove single triple clauses and put them directly into relevant store
      const simplifiedQuads = clauseToTriples(clause);
      if (simplifiedQuads) {
        removeClauseIdx.add(idx);
        for (const { quad, positive } of simplifiedQuads) {
          const quadStr = positive ? 'positive' : 'negative';
          quads[quadStr] = quads[quadStr] || mergeData(clause.positive);
          quads[quadStr]!.addQuad(quad);
        }
      }
    }
  }
  if (removeClauseIdx.size > 0) {
    clauses = clauses || [ ...clause.clauses ];
    clauses = clauses.filter((child, idx): boolean => !removeClauseIdx.has(idx));
  }
  
  // Check if we have a tautology
  if (isTautology(root, clause)) {
    return true;
  }
  
  // Remove duplicate and false triples  
  for (const side of [ 'positive', 'negative' ] as const) {
    const clauseQuads = quads[side] ? getQuads(quads[side]!) : getQuads(clause[side]);
    const removeIdx = new Set<number>();
    for (const [idxA, quadA] of clauseQuads.entries()) {
      // Remove "duplicates"
      for (const [idxB, quadB] of clauseQuads.entries()) {
        // TODO: this prevents removing both B in A || B || B
        if (idxA === idxB || removeIdx.has(idxB)) {
          continue;
        }
        if (impliesQuad(quadB, quadA, root.quantifiers)) {
          removeIdx.add(idxA);
          logger.debug(`${stringifyQuad(quadB)} implies ${stringifyQuad(quadA)} can be removed from disjunction (same disjunction)`);
          break;
        }
      }
      if (removeIdx.has(idxA)) {
        continue;
      }
      // Remove false values
      for (const rootQuad of root[side === 'positive' ? 'negative' : 'positive']) {
        // if (impliesQuad(quadA, quadB, root.quantifiers)) {
        if (equalOrLeftUniversal(rootQuad, quadA, root.quantifiers)) {
          removeIdx.add(idxA);
          logger.debug(`${stringifyQuad(rootQuad, true)} is known so ${stringifyQuad(quadA)} can be removed from disjunction (root data)`);
          break;
        }
      }
    }
    if (removeIdx.size > 0) {
      quads[side] = new Store(clauseQuads.filter((quad, idx): boolean => !removeIdx.has(idx)));
    }
  }
  
  const result: Clause = {
    conjunction: false,
    positive: quads.positive ?? clause.positive,
    negative: quads.negative ?? clause.negative,
    clauses: clauses ?? clause.clauses,
  };

  // We have removed all false values, so nothing true is left
  if (result.clauses.length === 0 && result.positive.size === 0 && result.negative.size === 0) {
    throw new Error(`Found a contradiction at root level, stopping execution. Caused by simplifying ${stringifyClause(clause)}`);
  }

  // Putting this after the contradiction check in case initial input already has an empty surface
  if (!quads.positive && !quads.negative && !clauses) {
    return;
  }

  return result;
}

export function simplifyLevel2(root: RootClause, clause: Clause): Clause | boolean | undefined {
  if (isContradiction(root, clause)) {
    logger.debug(`${stringifyClause(clause)} is a contradiction with root data`);
    return false;
  }

  const quads: { positive: Store | undefined; negative: Store | undefined } = { positive: undefined, negative: undefined };
     
  for (const side of [ 'positive', 'negative' ] as const) {
    const clauseQuads = getQuads(clause[side]);
    const removeIdx = new Set<number>();
    for (const [idxA, quadA] of clauseQuads.entries()) {
      // Remove "duplicates"
      for (const [idxB, quadB] of clauseQuads.entries()) {
        if (idxA === idxB || removeIdx.has(idxB)) {
          continue;
        }
        if (impliesQuad(quadB, quadA, root.quantifiers)) {
          logger.debug(`${stringifyQuad(quadB)} implies ${stringifyQuad(quadA)} can be removed from conjunction (same conjunction)`);
          removeIdx.add(idxA);
          break;
        }
      }
      if (removeIdx.has(idxA)) {
        continue;
      }
      // Remove true values
      for (const rootQuad of root[side]) {
        if (impliesQuad(rootQuad, quadA, root.quantifiers)) {
          logger.debug(`${stringifyQuad(rootQuad)} implies ${stringifyQuad(quadA,)} can be removed from conjunction (root data)`);
          removeIdx.add(idxA);
          break;
        }
      }
    }
    if (removeIdx.size > 0) {
      quads[side] = new Store(clauseQuads.filter((quad, idx): boolean => !removeIdx.has(idx)));
    }
  }

  const result: Clause = {
    conjunction: false,
    positive: quads.positive ?? clause.positive,
    negative: quads.negative ?? clause.negative,
    clauses: [],
  };
  
  if (result.positive.size === 0 && result.negative.size === 0) {
    return true;
  }
  
  // Putting this after the tautology check in case initial input already has an empty surface
  if (!quads.positive && !quads.negative) {
    return;
  }

  return result;
}

// TODO: level 1
//       A || -A
//       \exists x: f(x) || -(A)
//       A || -B if either A or -B is known at root 
export function isTautology(root: RootClause, clause: Clause): boolean {
  for (const positive of clause.positive) {
    for (const negative of clause.negative) {
      if (disjunctionTautology(positive, negative, root.quantifiers)) {
        return true;
      }
    }
  }

  for (const rootPositive of root.positive) {
    for (const positive of clause.positive) {
      if (impliesQuad(rootPositive, positive, root.quantifiers)) {
        return true;
      }
    }
  }
  
  for (const negative of clause.negative) {
    for (const rootNegative of root.negative) {
      if (impliesQuad(rootNegative, negative, root.quantifiers)) {
        return true;
      }
    }
  }
  
  return false;
}

// TODO: level 2
//   A && -A
//   \forall x: f(x) && -f(A)
//   A && -B if either -A or B are known at root
export function isContradiction(root: RootClause, clause: Clause): boolean {
  for (const positive of clause.positive) {
    for (const negative of clause.negative) {
      if (conjunctionContradiction(positive, negative, root.quantifiers)) {
        return true;
      }
    }
  }

  // Due to negation we don't use impliesQuad here.
  // f(A) && f(B) is a contradiction if -f(A) is known, or if \forall x: -f(x) is known.
  // \exists x: f(x) && f(B) is not a contradiction if -f(A) is known.
  // This is different from disjunction where f(A) implies a tautology in \exists x: f(x) || f(B)
  // and \forall x: f(x) implies a tautology in f(A) || f(B).
  for (const rootPositive of root.positive) {
    // TODO: duplication?
    for (const negative of clause.negative) {
      if (equalOrLeftUniversal(rootPositive, negative, root.quantifiers)) {
        return true;
      }
    }
  }
  for (const rootNegative of root.negative) {
    for (const positive of clause.positive) {
      if (equalOrLeftUniversal(rootNegative, positive, root.quantifiers)) {
        return true;
      }
    }
  }
  
  return false;
}

export type ClauseToTripleResult = { quad: Quad, positive: boolean };

export function clauseToTriples(clause: Clause): ClauseToTripleResult[] | undefined {
  if (clause.conjunction) {
    const result: ClauseToTripleResult[] = [];
    for (const quad of clause.positive) {
      result.push({ quad, positive: true });
    }
    for (const quad of clause.negative) {
      result.push({ quad, positive: false });
    }
    return result;
  }
  // Let's just assume we don't have empty clauses here
  if (clause.positive.size + clause.negative.size + clause.clauses.length > 1) {
    return;
  }
  if (clause.positive.size === 1) {
    return getQuads(clause.positive).map((quad): ClauseToTripleResult => ({ quad, positive: true}));
  }
  if (clause.negative.size === 1) {
    return getQuads(clause.negative).map((quad): ClauseToTripleResult => ({ quad, positive: false}));
  }
  return clauseToTriples(clause.clauses[0]);
}

export function compareTerms(left: Quad, right: Quad, comparator: (termLeft: Term, termRight: Term) => boolean | undefined): boolean {
  for (const pos of QUAD_POSITIONS) {
    const termLeft = left[pos];
    const termRight = right[pos];
    const result = comparator(termLeft, termRight);
    if (result === undefined) {
      continue;
    }
    return result;
  }  
  
  return true;
}

// TODO: all the functions below have issues with for example the same blank node occurring twice in a quad, need to track implied bindings

export function conjunctionContradiction(positive: Quad, negative: Quad, quantifiers: Record<string, number>): boolean {
  return compareTerms(positive, negative, (termLeft, termRight) => {
    if (isUniversal(termLeft, quantifiers)) {
      return;
    }
    if (isUniversal(termRight, quantifiers)) {
      return;
    }
    if (!termLeft.equals(termRight)) {
      return false;
    }
  });
}

export function disjunctionTautology(positive: Quad, negative: Quad, quantifiers: Record<string, number>): boolean {
  return compareTerms(positive, negative, (termLeft, termRight) => {
    if (isExistential(termLeft, quantifiers)) {
      return;
    }
    if (isExistential(termRight, quantifiers)) {
      return;
    }
    if (!termLeft.equals(termRight)) {
      return false;
    }
  });
}

export function equalOrLeftUniversal(left: Quad, right: Quad, quantifiers: Record<string, number>): boolean {
  return compareTerms(left, right, (termLeft, termRight) => {
    if (isUniversal(termLeft, quantifiers)) {
      return;
    }
    if (!termLeft.equals(termRight)) {
      return false;
    }
  });
}

// TODO: this function is identical to equalOrLeftUniversal, currently here for semantic reasons
export function impliesQuad(left: Quad, right: Quad, quantifiers: Record<string, number>): boolean {
  return compareTerms(left, right, (termLeft, termRight) => {
    if (isUniversal(termLeft, quantifiers)) {
      return;
    }
    // TODO: currently not using existentials as this breaks if you, for example, have the same existential in several parts of a conjunction
    //       e.g., \exists x: (f(x) && g(x)) || A can not be simplified to g(x) || A just because f(A) is known,
    //       g(A) would also have to be known
    // if (isExistential(termRight, quantifiers)) {
    //   return;
    // }
    if (!termLeft.equals(termRight)) {
      return false;
    }
  });
}

export function isUniversal(term: Term, quantifiers: Record<string, number>): boolean {
  return term.termType === 'BlankNode' && isBlankNodeUniversal(term, quantifiers);
}

export function isExistential(term: Term, quantifiers: Record<string, number>): boolean {
  return term.termType === 'BlankNode' && !isBlankNodeUniversal(term, quantifiers);
}

export function isBlankNodeUniversal(blankNode: BlankNode, quantifiers: Record<string, number>): boolean {
  return (quantifiers[blankNode.value] ?? 0) % 2 === 1;
}
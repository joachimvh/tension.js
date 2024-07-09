import { BlankNode, NamedNode, Quad } from '@rdfjs/types';
import { DataFactory, Store } from 'n3';
import { Formula, NegativeSurface, QUAD_POSITIONS } from './ParseUtil';


export type Clause = {
  conjunction: boolean;
  positive: Quad[];
  negative: Quad[];
  clauses: Clause[];
}

export type LeafClause = Clause & {
  clauses: [];
};

export type RootClause = Clause & {
  quantifiers: Record<string, number>;
};

export function createClause(options: Partial<Clause> & { conjunction: boolean }): Clause {
  return {
    ...options,
    conjunction: options.conjunction,
    positive: options.positive ?? [],
    negative: options.negative ?? [],
    clauses: options.clauses ?? [],
  }
}

export function removeDuplicateBlankNodes(formula: Formula, names: Set<string> = new Set(), map: Record<string, BlankNode> = {}): Formula {
  const newQuads: Quad[] = [];
  let changed = false;
  for (const quad of formula.data) {
    let changedQuad = false;
    let newPos: Partial<Quad> = {};
    for (const pos of QUAD_POSITIONS) {
      const term = quad[pos];
      if (term.termType === 'BlankNode') {
        // Could have blank nodes not in graffiti, also need to account for those
        names.add(term.value);
        const newNode = map[term.value];
        if (newNode) {
          changed = true;
          changedQuad = true;
          // Get around Quad_Predicate typing issues
          newPos[pos] = newNode as unknown as NamedNode;
        }
      }
    }
    if (changedQuad) {
      newQuads.push(DataFactory.quad(newPos.subject ?? quad.subject, newPos.predicate ?? quad.predicate, newPos.object ?? quad.object));
    } else {
      newQuads.push(quad);
    }
  }

  if (changed) {
    formula.data = newQuads;
  }

  // Recursively update the surfaces and apply the graffiti
  for (const surface of formula.surfaces) {
    const newMap: Record<string, BlankNode> = {};
    // TODO: remove graffiti that isn't used
    for (const [ idx, node ] of surface.graffiti.entries()) {
      if (names.has(node.value)) {
        let newNode: BlankNode;
        do {
          newNode = DataFactory.blankNode();
        } while (names.has(newNode.value));
        newMap[node.value] = newNode;
        names.add(newNode.value);
        surface.graffiti[idx] = newNode;
      } else {
        names.add(node.value);
      }
    }
    removeDuplicateBlankNodes(surface.formula, names, {...map, ...newMap});
  }

  return formula;
}

export function pullGraffitiUp(formula: Formula): Formula {
  // We introduce a new surface which emulates the root level,
  // so we can afterwards drop all graffiti that ended up in the root.
  const rootSurface: NegativeSurface = { graffiti: [], formula, answer: false };
  optimizeSurfaceGraffiti(rootSurface);
  // The input formula will have been updated correctly and all root graffiti will be dropped automatically
  // since we no longer use the `rootSurface`.
  return formula;
}

export function optimizeSurfaceGraffiti(surface: NegativeSurface): void {
  const childSurfaces = surface.formula.surfaces;

  for (const child of childSurfaces) {
    optimizeSurfaceGraffiti(child);
    if (child.graffiti.length === 0) {
      // Graffiti of all sub children here can be added
      for (const subChild of child.formula.surfaces) {
        surface.graffiti.push(...subChild.graffiti);
        subChild.graffiti = [];
      }
    }
  }
}

export function toClause(formula: Formula): RootClause {
  const rootClause: RootClause = {
    ...createClause({ conjunction: true, positive: formula.data }),
    quantifiers: {},
  }
  for (const surface of formula.surfaces) {
    rootClause.clauses.push(surfaceToClause(surface, rootClause.quantifiers));
  }
  return rootClause;
}

// TODO: assumes graffiti was already lifted
// TODO: level 1 and further levels differ in what they do
export function surfaceToClause(surface: NegativeSurface, quantifierMap: Record<string, number>, level = 1): Clause {
  // Set graffiti quantifiers at the correct level
  for (const blank of surface.graffiti) {
    quantifierMap[blank.value] = level;
  }

  const children = surface.formula.surfaces.map((child): Clause => surfaceToClause(child, quantifierMap, level + 1));
  const negative: Quad[] = [];
  const positive = surface.formula.data;
  const conjs = children.filter((clause): boolean => clause.conjunction);
  const disjs = children.filter((clause): boolean => !clause.conjunction);
  for (const conj of conjs) {
    positive.push(...conj.positive);
    negative.push(...conj.negative);
    disjs.push(...conj.clauses);
  }
  const clauses: Clause[] = [];
  for (const disj of disjs) {
    for (const child of flattenClause(disj)) {
      if (child.clauses.length === 0 && child.positive.length + child.negative.length === 1) {
        if (child.positive.length === 1) {
          positive.push(...child.positive);
        } else {
          negative.push(...child.negative);
        }
      } else {
        clauses.push(child);
      }
    }
  }

  const clause = createClause({
    conjunction: true,
    positive,
    negative,
    clauses,
  });
  // TODO: this implies it might have been smarter to start from the bottom
  return negateClause(clause);
}

export function* flattenClause(clause: Clause): IterableIterator<LeafClause> {
  if (clause.clauses.length === 0) {
    yield clause as LeafClause;
    return;
  }
  const crossProduct = crossProductClauses(clause.clauses as LeafClause[], clause.conjunction);
  if (clause.positive.length === 0 && clause.negative.length === 0) {
    yield* crossProduct;
  }
  for (const product of crossProduct) {
    // Combine every product with the remaining triples that were already there
    yield createClause({
      conjunction: product.conjunction,
      positive: clause.positive.length === 0 ? product.positive : mergeData(product.positive, clause.positive),
      negative: clause.negative.length === 0 ? product.negative : mergeData(product.negative, clause.negative),
    }) as LeafClause;
  }
}

export function* crossProductClauses(clauses: LeafClause[], conjunction: boolean): IterableIterator<LeafClause> {
  if (clauses.length === 0) {
    yield createClause({ conjunction }) as LeafClause;
    return;
  }
  const clause = clauses.pop()!;
  for (const product of crossProductClauses(clauses, conjunction)) {
    for (const side of [ 'positive', 'negative' ] as const) {
      for (const quad of clause[side]) {
        yield createClause({
          conjunction: product.conjunction,
          positive: side === 'positive' ? mergeData(product.positive, quad) : product.positive,
          negative: side === 'negative' ? mergeData(product.negative, quad) : product.negative,
        }) as LeafClause;
      }
    }
  }
}

export function negateClause(clause: Clause): Clause {
  return createClause({
    conjunction: !clause.conjunction,
    positive: clause.negative,
    negative: clause.positive,
    clauses: clause.clauses.map(negateClause),
  });
}

// Interpret the results of an answer clause as a clause that needs to be fulfilled
export function findAnswerClauses(formula: Formula, level = 0): Clause[] {
  const result: Clause[] = [];
  for (const surface of formula.surfaces) {
    if (surface.answer) {
      let clause = surfaceToClause(surface, {});
      if (level % 2 === 0) {
        clause = negateClause(clause);
      }
      result.push(clause);
    }
    result.push(...findAnswerClauses(surface.formula));
  }
  return result;
}

export function isSameClause(left: Clause, right: Clause): boolean {
  if (left.conjunction !== right.conjunction ||
    left.positive.length !== right.positive.length ||
    left.negative.length !== right.negative.length ||
    left.clauses.length !== right.clauses.length) {
    return false;
  }
  for (const leftQuad of left.positive) {
    if (!right.positive.some((quad): boolean => quad.equals(leftQuad))) {
      return false;
    }
  }
  for (const leftQuad of left.negative) {
    if (!right.negative.some((quad): boolean => quad.equals(leftQuad))) {
      return false;
    }
  }

  return left.clauses.every((leftClause): boolean => right.clauses.some((rightClause): boolean => isSameClause(leftClause, rightClause)));
}

export function isDisjunctionSubset(left: Clause, right: Clause, quantifiers: Record<string, number>, blankMap: Record<string, string> = {}): boolean {
  // Although you could see f(A) as being a subset of ∀x: f(x),
  // we still need f(A) to make our reasoning steps work,
  // which is why we only check equality here.
  for (const side of [ 'positive', 'negative' ] as const) {
    // For each left quad, check if we can find at least one matching right quad
    for (const leftQuad of left[side]) {
      let match = false;
      for (const rightQuad of right[side]) {
        // TODO: params get switched in recursive call but need to make sure blankMap is still used correctly
        match = quadEqualsUniversal(left.conjunction ? leftQuad : rightQuad, left.conjunction ? rightQuad : leftQuad, quantifiers, blankMap);
        if (match) {
          break;
        }
      }
      if (!match) {
        return false;
      }
    }
  }
  for (const leftClause of left.clauses) {
    // TODO: notice the swapped order!
    if (!right.clauses.some((rightClause): boolean => isDisjunctionSubset(rightClause, leftClause, quantifiers, blankMap))) {
      return false;
    }
  }
  return true;
}

// TODO: checks equality but also allows different blank nodes in the same position if there is a valid mapping.
export function quadEqualsUniversal(left: Quad, right: Quad, quantifiers: Record<string, number>, blankMap: Record<string, string>): boolean {
  const newBlankMap = { ...blankMap };
  for (const pos of QUAD_POSITIONS) {
    const leftTerm = left[pos];
    const rightTerm = right[pos];
    if (leftTerm.termType === 'BlankNode' && rightTerm.termType === 'BlankNode') {
      if (quantifiers[leftTerm.value] !== quantifiers[rightTerm.value]) {
        return false;
      }
      if (newBlankMap[leftTerm.value] && newBlankMap[leftTerm.value] !== rightTerm.value) {
        return false;
      }
      newBlankMap[leftTerm.value] = rightTerm.value;
    } else if (!leftTerm.equals(rightTerm)) {
      return false;
    }
  }
  // Only updating blankMap here as partial results above could have added info before noticing there was no match
  Object.assign(blankMap, newBlankMap);
  return true;
}

export function getQuads(store: Store): Quad[] {
  return store.getQuads(null, null, null, null);
}

// TODO: nog longer checking uniqueness
export function mergeData(...args: (Store | Quad[] | Quad)[]): Quad[] {
  const result: Quad[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      result.push(...arg);
    } else if ('subject' in arg) {
      result.push(arg);
    } else {
      result.push(...getQuads(arg));
    }
  }
  return result;
}

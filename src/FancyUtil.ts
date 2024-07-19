import type { BlankNode, Literal, Term } from '@rdfjs/types';
import { QUAD_POSITIONS } from './ParseUtil';

export type FancyQuad = {
  subject: FancyTerm;
  predicate: FancyTerm;
  object: FancyTerm;
};
export type SimpleQuad = {
  subject: Term;
  predicate: Term;
  object: Term;
};

export type List = {
  termType: 'List';
  value: FancyTerm[];
};

export type Graph = {
  termType: 'Graph';
  value: FancyQuad[];
};

export type FancyTerm = Term | Graph | List;

export function isSimpleTerm(input: FancyTerm): input is Term {
  return input.termType !== 'Graph' && input.termType !== 'List';
}

export function isSimpleQuad(input: FancyQuad): input is SimpleQuad {
  for (const pos of QUAD_POSITIONS) {
    if (!isSimpleTerm(input[pos])) {
      return false;
    }
  }
  return true;
}

export function fancyEquals(left: FancyQuad | FancyTerm, right: FancyQuad | FancyTerm): boolean {
  if ('subject' in left) {
    if (!('subject' in right)) {
      return false;
    }
    return fancyEquals(left.subject, right.subject) &&
      fancyEquals(left.predicate, right.predicate) &&
      fancyEquals(left.object, right.object);
  }
  if ('subject' in right) {
    return false;
  }

  if (left.termType !== right.termType) {
    return false;
  }

  if (left.termType === 'Graph' || left.termType === 'List') {
    return left.value.length === right.value.length &&
      left.value.every((child, idx): boolean => fancyEquals(child, (right as Graph | List).value[idx]));
  }

  if (left.termType === 'Literal') {
    return left.value === right.value &&
      left.datatype.value === (right as Literal).datatype.value &&
      left.language === (right as Literal).language;
  }

  return left.value === right.value;
}

export function compareTerms(
  left: FancyQuad,
  right: FancyQuad,
  comparator: (termLeft: FancyTerm, termRight: FancyTerm) => boolean | undefined,
): boolean {
  for (const pos of QUAD_POSITIONS) {
    const termLeft = left[pos];
    const termRight = right[pos];
    // TODO: here and all other ones: recursive checks in lists/graphs
    const result = comparator(termLeft, termRight);
    if (typeof result === 'boolean') {
      return result;
    }
  }

  return true;
}

// TODO: all the functions below have issues with for example the same blank node occurring twice in a quad,
//       need to track implied bindings

// TODO: used for contradiction checks in conjunctions
export function equalOrUniversal(
  positive: FancyQuad,
  negative: FancyQuad,
  quantifiers: Record<string, number>,
): boolean {
  return compareTerms(positive, negative, (termLeft, termRight): boolean | undefined => {
    if (isUniversal(termLeft, quantifiers)) {
      return;
    }
    if (isUniversal(termRight, quantifiers)) {
      return;
    }
    if (!fancyEquals(termLeft, termRight)) {
      return false;
    }
  });
}

// TODO: used for tautology checks in disjunctions
export function equalOrExistential(
  positive: FancyQuad,
  negative: FancyQuad,
  quantifiers: Record<string, number>,
): boolean {
  return compareTerms(positive, negative, (termLeft, termRight): boolean | undefined => {
    if (isExistential(termLeft, quantifiers) && !isUniversal(termRight, quantifiers)) {
      return;
    }
    if (isExistential(termRight, quantifiers) && !isUniversal(termLeft, quantifiers)) {
      return;
    }
    if (!fancyEquals(termLeft, termRight)) {
      return false;
    }
  });
}

// TODO: this function is identical to equalOrLeftUniversal, currently here for semantic reasons
export function impliesQuad(left: FancyQuad, right: FancyQuad, quantifiers: Record<string, number>): boolean {
  return compareTerms(left, right, (termLeft, termRight): boolean | undefined => {
    if (isUniversal(termLeft, quantifiers)) {
      return;
    }
    // TODO: currently not using existentials as this breaks if you, for example,
    //       have the same existential in several parts of a conjunction
    //       e.g., \exists x: (f(x) && g(x)) || A can not be simplified to g(x) || A just because f(A) is known,
    //       g(A) would also have to be known
    //       similarly there are also issues with disjunctions: f(A) and \exists -f(x) || g(x) does not imply g(x)
    // if (isExistential(termRight, quantifiers)) {
    //   return;
    // }
    if (!fancyEquals(termLeft, termRight)) {
      return false;
    }
  });
}

export function isUniversal(term: FancyTerm, quantifiers: Record<string, number>): term is BlankNode {
  return term.termType === 'BlankNode' && isBlankNodeUniversal(term, quantifiers);
}

export function isExistential(term: FancyTerm, quantifiers: Record<string, number>): term is BlankNode {
  return term.termType === 'BlankNode' && !isBlankNodeUniversal(term, quantifiers);
}

export function isBlankNodeUniversal(blankNode: BlankNode, quantifiers: Record<string, number>): boolean {
  return (quantifiers[blankNode.value] ?? 0) % 2 === 1;
}

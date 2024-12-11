import type { BlankNode, Literal, Term } from '@rdfjs/types';
import type { Binding } from './BindUtil';
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

// TODO: need to improve equality checks between number, integer and other literals
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

export function compareQuadTerms(
  left: FancyQuad,
  right: FancyQuad,
  comparator: (termLeft: FancyTerm, termRight: FancyTerm, binding: Binding) => boolean | undefined,
  binding: Binding = {},
): boolean {
  for (const pos of QUAD_POSITIONS) {
    const termLeft = left[pos];
    const termRight = right[pos];

    const result = compareTerms(termLeft, termRight, comparator, binding);
    if (result === false) {
      return result;
    }
  }

  return true;
}

export function compareTerms(
  termLeft: FancyTerm,
  termRight: FancyTerm,
  comparator: (termLeft: FancyTerm, termRight: FancyTerm, binding: Binding) => boolean | undefined,
  binding: Binding = {},
): boolean | undefined {
  // TODO: merge these
  if (termLeft.termType === 'BlankNode' && binding[termLeft.value] &&
    !fancyEquals(termLeft, termRight) && !fancyEquals(binding[termLeft.value], termRight)) {
    return false;
  }
  if (termRight.termType === 'BlankNode' && binding[termRight.value] &&
    !fancyEquals(termRight, termLeft) && !fancyEquals(binding[termRight.value], termLeft)) {
    return false;
  }

  if ((termLeft.termType === 'List' || termLeft.termType === 'Graph') && termRight.termType === termLeft.termType) {
    if (termLeft.value.length !== termRight.value.length) {
      return false;
    }
    for (let i = 0; i < termLeft.value.length; ++i) {
      const compareFn = termLeft.termType === 'Graph' ? compareQuadTerms : compareTerms;
      const result = compareFn(
        termLeft.value[i] as FancyTerm & FancyQuad,
        termRight.value[i] as FancyTerm & FancyQuad,
        comparator,
        binding,
      );
      if (typeof result === 'boolean') {
        return result;
      }
    }
  } else {
    const result = comparator(termLeft, termRight, binding);
    if (typeof result === 'boolean') {
      return result;
    }
  }
}

// TODO: all the functions below have issues with for example the same blank node occurring twice in a quad,
//       need to track implied bindings

// TODO: used for contradiction checks in conjunctions
export function equalOrUniversal(
  positive: FancyQuad,
  negative: FancyQuad,
  quantifiers: Record<string, number>,
): boolean {
  return compareQuadTerms(positive, negative, (termLeft, termRight, binding): boolean | undefined => {
    if (isUniversal(termLeft, quantifiers)) {
      // TODO: doing duplicate checks, need to improve this structure
      if (!fancyEquals(termLeft, termRight)) {
        binding[termLeft.value] = termRight;
      }
      return;
    }
    if (isUniversal(termRight, quantifiers)) {
      if (!fancyEquals(termLeft, termRight)) {
        binding[termRight.value] = termLeft;
      }
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
  return compareQuadTerms(positive, negative, (termLeft, termRight, binding): boolean | undefined => {
    if (isExistential(termLeft, quantifiers) && !isUniversal(termRight, quantifiers)) {
      if (!fancyEquals(termLeft, termRight)) {
        binding[termLeft.value] = termRight;
      }
      return;
    }
    if (isExistential(termRight, quantifiers) && !isUniversal(termLeft, quantifiers)) {
      if (!fancyEquals(termLeft, termRight)) {
        binding[termRight.value] = termLeft;
      }
      return;
    }
    if (!fancyEquals(termLeft, termRight)) {
      return false;
    }
  });
}

export function impliesQuad(left: FancyQuad, right: FancyQuad, quantifiers: Record<string, number>): boolean {
  return compareQuadTerms(left, right, (termLeft, termRight, binding): boolean | undefined => {
    if (isUniversal(termLeft, quantifiers)) {
      if (!fancyEquals(termLeft, termRight)) {
        binding[termLeft.value] = termRight;
      }
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

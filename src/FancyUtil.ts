import type { Literal, Term } from '@rdfjs/types';
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

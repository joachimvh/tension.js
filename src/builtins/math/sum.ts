import type { Binding } from '../../BindUtil';
import type { BuiltinBindFn, BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';
import { performSum } from '../../TermUtil';

// TODO: very similar to difference

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.subject.termType !== 'List' || quad.subject.value.length !== 2 ||
    quad.object.termType !== 'Literal' || Number.isNaN(quad.object.value)) {
    return;
  }

  const [ left, right ] = quad.subject.value;
  if (left.termType !== 'Literal' || right.termType !== 'Literal' ||
    Number.isNaN(left.value) || Number.isNaN(right.value)) {
    return;
  }

  return Number.parseInt(left.value, 10) + Number.parseInt(right.value, 10) === Number.parseInt(quad.object.value, 10);
};

const bind: BuiltinBindFn = ({ quad }: BuiltinCallOptions): Binding | undefined => {
  if (quad.subject.termType !== 'List' || quad.subject.value.length !== 2) {
    return;
  }
  const [ left, right ] = quad.subject.value;

  const blankNodeCount = [ left, right, quad.object ].filter((term): boolean => term.termType === 'BlankNode').length;
  if (blankNodeCount !== 1) {
    return;
  }

  if (quad.object.termType === 'BlankNode') {
    const result = performSum(left, right, false);
    return result ? { [quad.object.value]: result } : undefined;
  }
  if (left.termType === 'BlankNode') {
    const result = performSum(quad.object, right, true);
    return result ? { [left.value]: result } : undefined;
  }
  // Right is only remaining blank node option
  const result = performSum(quad.object, left, true);
  return result ? { [right.value as string]: result } : undefined;
};

export default {
  predicate: 'http://www.w3.org/2000/10/swap/math#sum',
  check,
  bind,
} satisfies BuiltinImplementation;

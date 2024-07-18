import type { BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';
import { compareLiterals } from '../../TermUtil';

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  const result = compareLiterals(quad.subject, quad.object);
  return typeof result === 'number' ? result > 0 : undefined;
};

export default {
  predicate: 'http://www.w3.org/2000/10/swap/math#greaterThan',
  check,
} satisfies BuiltinImplementation;

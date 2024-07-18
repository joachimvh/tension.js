import type { BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';
import { fancyEquals } from '../../FancyUtil';

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.subject.termType !== 'List') {
    return;
  }

  return quad.subject.value.some((entry): boolean => fancyEquals(entry, quad.object));
};

export default {
  predicate: 'http://www.w3.org/2000/10/swap/list#member',
  check,
} satisfies BuiltinImplementation;

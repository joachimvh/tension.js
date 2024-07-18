import type { BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';
import { fancyEquals } from '../../FancyUtil';

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.object.termType !== 'List') {
    return;
  }

  return quad.object.value.some((entry): boolean => fancyEquals(entry, quad.subject));
};

export default {
  predicate: 'http://www.w3.org/2000/10/swap/list#in',
  check,
} satisfies BuiltinImplementation;

import type { Binding } from '../../BindUtil';
import type { BuiltinBindFn, BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';
import { fancyEquals } from '../../FancyUtil';

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.subject.termType !== 'List' || quad.subject.value.length === 0) {
    return;
  }
  return fancyEquals(quad.subject.value.at(-1)!, quad.object);
};

const bind: BuiltinBindFn = ({ quad }: BuiltinCallOptions): Binding | undefined => {
  if (quad.subject.termType !== 'List' || quad.subject.value.length === 0 || quad.object.termType !== 'BlankNode') {
    return;
  }
  return { [quad.object.value]: quad.subject.value.at(-1)! };
};

export default {
  predicate: 'http://www.w3.org/2000/10/swap/list#last',
  check,
  bind,
} satisfies BuiltinImplementation;

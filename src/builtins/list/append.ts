import { Binding } from '../../BindUtil';
import { BuiltinBindFn, BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';
import { fancyEquals } from '../../FancyUtil';

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.subject.termType !== 'List' || quad.subject.value.some((entry): boolean => entry.termType !== 'List') || quad.object.termType !== 'List') {
    return;
  }

  const flat = quad.subject.value.flat();
  if (flat.length !== quad.object.value.length) {
    return false;
  }
  for (let i = 0; i < flat.length; ++i) {
    if (!fancyEquals(flat[i], quad.object.value[i])) {
      return false;
    }
  }
  return true;
}

const bind: BuiltinBindFn = ({ quad }: BuiltinCallOptions): Binding | undefined => {
  if (quad.subject.termType !== 'List' || quad.subject.value.some((entry): boolean => entry.termType !== 'List') || quad.object.termType !== 'BlankNode') {
    return;
  }
  return { [quad.object.value]: { termType: 'List', value: quad.subject.value.flat() } };
}

export default {
  predicate: 'http://www.w3.org/2000/10/swap/list#append',
  check,
  bind,
} satisfies BuiltinImplementation;

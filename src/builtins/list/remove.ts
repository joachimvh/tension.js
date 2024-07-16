import { Binding } from '../../BindUtil';
import { BuiltinBindFn, BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';
import { fancyEquals } from '../../FancyUtil';

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.subject.termType !== 'List' || quad.object.termType !== 'List') {
    return;
  }

  const [ left, right ] = quad.subject.value;
  if (left.termType !== 'List' || right.termType !== 'List') {
    return;
  }

  const filtered = left.value.filter((leftEntry): boolean => right.value.some((rightEntry): boolean => fancyEquals(leftEntry, rightEntry)));
  if (filtered.length !== quad.object.value.length) {
    return false;
  }
  for (let i = 0; i < filtered.length; i++) {
    if (!fancyEquals(filtered[i], quad.object.value[i])) {
      return false;
    }
  }
  return true;
}

const bind: BuiltinBindFn = ({ quad }: BuiltinCallOptions): Binding | undefined => {
  if (quad.subject.termType !== 'List' || quad.object.termType !== 'BlankNode') {
    return;
  }

  const [ left, right ] = quad.subject.value;
  if (left.termType !== 'List' || right.termType !== 'List') {
    return;
  }
  const filtered = left.value.filter((leftEntry): boolean => right.value.some((rightEntry): boolean => fancyEquals(leftEntry, rightEntry)));
  return { [quad.object.value]: { termType: 'List', value: filtered }};
}

export default {
  predicate: 'http://www.w3.org/2000/10/swap/list#remove',
  check,
  bind,
} satisfies BuiltinImplementation;

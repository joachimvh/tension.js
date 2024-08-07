import { DataFactory } from 'n3';
import type { Binding } from '../../BindUtil';
import type { BuiltinBindFn, BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.subject.termType !== 'List' || quad.object.termType !== 'Literal') {
    return;
  }
  return quad.subject.value.length === Number.parseInt(quad.object.value, 10);
};

const bind: BuiltinBindFn = ({ quad }: BuiltinCallOptions): Binding | undefined => {
  if (quad.subject.termType !== 'List' || quad.object.termType !== 'BlankNode') {
    return;
  }
  return { [quad.object.value]: DataFactory.literal(quad.subject.value.length) };
};

export default {
  predicate: 'http://www.w3.org/2000/10/swap/list#length',
  check,
  bind,
} satisfies BuiltinImplementation;

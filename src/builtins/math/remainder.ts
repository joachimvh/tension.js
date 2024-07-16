import { DataFactory } from 'n3';
import { Binding } from '../../BindUtil';
import { BuiltinBindFn, BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';

// TODO: reusing a lot of the same checks for math stuff

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.subject.termType !== 'List' || quad.subject.value.length !== 2 || quad.object.termType !== 'Literal' || Number.isNaN(quad.object.value)) {
    return;
  }

  const [ left, right ] = quad.subject.value;
  if (left.termType !== 'Literal' || right.termType !== 'Literal' || Number.isNaN(left.value) || Number.isNaN(right.value)) {
    return;
  }

  return Number.parseInt(left.value) % Number.parseInt(right.value) === Number.parseInt(quad.object.value);
}

const bind: BuiltinBindFn = ({ quad }: BuiltinCallOptions): Binding | undefined => {
  if (quad.subject.termType !== 'List' || quad.subject.value.length !== 2 || quad.object.termType !== 'BlankNode') {
    return;
  }

  const [ left, right ] = quad.subject.value;
  if (left.termType !== 'Literal' || right.termType !== 'Literal' || Number.isNaN(left.value) || Number.isNaN(right.value)) {
    return;
  }

  return { [quad.object.value]: DataFactory.literal(Number.parseInt(left.value) % Number.parseInt(right.value)) };
}

export default {
  predicate: 'http://www.w3.org/2000/10/swap/math#remainder',
  check,
  bind,
} satisfies BuiltinImplementation;

import { BuiltinCallOptions, BuiltinCheckFn, BuiltinImplementation } from '../../BuiltinUtil';
import { fancyEquals } from '../../FancyUtil';

const check: BuiltinCheckFn = ({ quad }: BuiltinCallOptions): boolean | undefined => {
  if (quad.subject.termType === 'BlankNode' || quad.object.termType === 'BlankNode') {
    return quad.subject.termType === quad.object.termType && quad.subject.value === quad.object.value ? true : undefined;
  }

  return fancyEquals(quad.subject, quad.object);
}

export default {
  predicate: 'http://www.w3.org/2000/10/swap/log#equalTo',
  check,
} satisfies BuiltinImplementation;

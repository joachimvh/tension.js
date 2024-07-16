import { DataFactory } from 'n3';
import { Binding } from '../../BindUtil';
import { BuiltinBindFn, BuiltinCallOptions, BuiltinImplementation } from '../../BuiltinUtil';
import { XSD_DATETIME } from '../../TermUtil';

const bind: BuiltinBindFn = ({ quad }: BuiltinCallOptions): Binding | undefined => {
  if (quad.object.termType !== 'BlankNode') {
    return;
  }
  return { [quad.object.value]: DataFactory.literal(new Date().toISOString(), DataFactory.namedNode(XSD_DATETIME)) };
}

export default {
  predicate: 'http://www.w3.org/2000/10/swap/time#localTime',
  bind
} satisfies BuiltinImplementation;

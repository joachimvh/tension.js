import { parse, toSeconds } from 'iso8601-duration';
import { DataFactory } from 'n3';
import type { FancyTerm } from './FancyUtil';

export const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime';
export const XSD_DATE = 'http://www.w3.org/2001/XMLSchema#date';
export const XSD_DURATION = 'http://www.w3.org/2001/XMLSchema#duration';

export function compareLiterals(left: FancyTerm, right: FancyTerm): number | undefined {
  if (left.termType !== 'Literal' || right.termType !== 'Literal') {
    return;
  }

  if (left.datatype.value === XSD_DATETIME || left.datatype.value === XSD_DATE) {
    if (right.datatype.value !== XSD_DATETIME && right.datatype.value !== XSD_DATE) {
      return;
    }
    return new Date(left.value).getTime() - new Date(right.value).getTime();
  }

  if (left.datatype.value === XSD_DURATION) {
    if (right.datatype.value !== XSD_DURATION) {
      return;
    }
    return toSeconds(parse(left.value)) - toSeconds(parse(right.value));
  }

  if (Number.isNaN(left.value) || Number.isNaN(right.value)) {
    return;
  }
  const leftNumber = Number.parseInt(left.value, 10);
  const rightNumber = Number.parseInt(right.value, 10);
  return leftNumber - rightNumber;
}

// TODO: date + date = error
//       date + duration = date
//       duration + duration = duration
//       date - date = duration
//       date - duration = date
//       duration - date = error
//       duration - duration = error

// TODO: can throw errors so should be wrapped
export function performSum(left: FancyTerm, right: FancyTerm, minus: boolean): FancyTerm | undefined {
  if (left.termType !== 'Literal' || right.termType !== 'Literal') {
    return;
  }

  if (left.datatype.value === XSD_DATETIME || left.datatype.value === XSD_DATE) {
    const leftDate = new Date(left.value);
    if (right.datatype.value === XSD_DATETIME || right.datatype.value === XSD_DATE) {
      if (!minus) {
        return;
      }
      const rightDate = new Date(right.value);
      const diff = leftDate.getTime() - rightDate.getTime();
      if (diff < 0) {
        return;
      }
      const duration = `PT${Math.floor(diff / 1000)}S`;
      return DataFactory.literal(duration, DataFactory.namedNode(XSD_DURATION));
    }
    if (right.datatype.value === XSD_DURATION) {
      const rightMilliSeconds = toSeconds(parse(right.value)) * 1000;
      const result = new Date(minus ? leftDate.getTime() - rightMilliSeconds : leftDate.getTime() + rightMilliSeconds);
      return DataFactory.literal(result.toISOString(), XSD_DATETIME);
    }
  }

  if (left.datatype.value === XSD_DURATION) {
    const leftSeconds = toSeconds(parse(left.value));
    // TODO: duplication
    if (right.datatype.value === XSD_DATETIME || right.datatype.value === XSD_DATE) {
      if (minus) {
        return;
      }
      const rightDate = new Date(right.value);
      const result = new Date(leftSeconds * 1000 + rightDate.getTime());
      return DataFactory.literal(result.toISOString(), XSD_DATETIME);
    }
    if (right.datatype.value === XSD_DURATION) {
      const rightSeconds = toSeconds(parse(right.value));
      const result = minus ? leftSeconds - rightSeconds : leftSeconds + rightSeconds;
      if (result < 0) {
        return;
      }
      return DataFactory.literal(`PT${result}S`, DataFactory.namedNode(XSD_DURATION));
    }
  }

  if (Number.isNaN(left.value) || Number.isNaN(right.value)) {
    return;
  }
  const leftNumber = Number.parseInt(left.value, 10);
  const rightNumber = Number.parseInt(right.value, 10);
  return DataFactory.literal(minus ? leftNumber - rightNumber : leftNumber + rightNumber);
}

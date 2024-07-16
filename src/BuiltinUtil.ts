import { lstat, readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { applyBindings, Binding } from './BindUtil';
import { Clause, RootClause } from './ClauseUtil';
import { FancyQuad, FancyTerm } from './FancyUtil';
import { getLogger } from './LogUtil';
import { stringifyClause } from './ParseUtil';

const logger = getLogger('Builtin');

export type BuiltinCallOptions = {
  quad: FancyQuad,
  clause: Clause,
  root: RootClause
}

export type BuiltinCheckFn = (options: BuiltinCallOptions) => boolean | undefined;
export type BuiltinBindFn = (options: BuiltinCallOptions) => Binding | undefined;
export type BuiltinImplementation = {
  predicate: string,
  check?: BuiltinCheckFn,
  bind?: BuiltinBindFn,
};

const builtins: Record<string, BuiltinImplementation | undefined> = {};

// TODO: this will have to change if this library every needs to be used as a dependency
export async function loadBuiltins(): Promise<void> {
  // Using posix join as import doesn't like the backslashes
  return loadFromDir(posix.join(__dirname, 'builtins'));
}

export async function loadFromDir(dirPath: string): Promise<void> {
  const files = await readdir(dirPath);
  for (const file of files) {
    const fullPath = posix.join(dirPath, file);
    if (file.endsWith('.js')) {
      const imported = await import(fullPath.replace(__dirname, '.'));
      const imp: BuiltinImplementation = imported.default.default;
      if (builtins[imp.predicate]) {
        throw new Error(`Trying to assign 2 builtins to ${imp.predicate}`);
      }
      builtins[imp.predicate] = imp;
    } else {
      const stat = await lstat(fullPath);
      if (stat.isDirectory()) {
        await loadFromDir(fullPath);
      }
    }
  }
}

export function handleBuiltinCheck(options: BuiltinCallOptions): boolean | undefined {
  const pred = options.quad.predicate.value;
  if (typeof pred !== 'string') {
    return;
  }
  const builtin = builtins[pred];
  if (builtin?.check) {
    return builtin.check(options);
  }
}

export function handleBuiltinBind(options: BuiltinCallOptions): Record<string, FancyTerm> | undefined {
  const pred = options.quad.predicate.value;
  if (typeof pred !== 'string') {
    return;
  }
  const builtin = builtins[pred];
  if (builtin?.bind) {
    return builtin.bind(options);
  }
}

// TODO: move this perhaps
export type BuiltinCache = WeakSet<Clause>;

export type BuiltinBindResult = {
  idx: number,
  clause: Clause,
};

// TODO: we now have this function and the parts in the simplify call,
//       it feels like those simplify calls could also be handled here as that is also just removing triples
//       perhaps single function that returns `Binding | false | undefined`?
export function* generateBuiltinResultClauses(root: RootClause, cache?: BuiltinCache): IterableIterator<BuiltinBindResult> {
  cache = cache || new WeakSet();

  for (const [ idx, clause ] of root.clauses.entries()) {
    const result = bindClauseBuiltins(root, clause, cache);
    if (result?.clause) {
      // Need to apply the bindings to any other occurrences of the same blank node in the clause
      const bound = applyBindings(result.clause, result.binding) || result.clause;
      logger.debug(`generated ${stringifyClause(bound)} by applying builtins in  ${stringifyClause(clause)}`);
      yield { idx, clause: bound };
    }
  }
}

export function bindClauseBuiltins(root: RootClause, clause: Clause, cache: BuiltinCache): { clause?: Clause, binding: Binding } | undefined {
  if (!clause.conjunction && cache.has(clause)) {
    return;
  }
  const binding: Binding = {};
  // TODO: not that useful to already do this since we work with remove sets again?
  const newClause: Clause = {
    conjunction: clause.conjunction,
    positive: [ ...clause.positive ],
    negative: [ ...clause.negative ],
    clauses: [ ...clause.clauses ],
  };
  const removeClauseSet = new Set<number>();
  for (const [ idx, child ] of clause.clauses.entries()) {
    const result = bindClauseBuiltins(root, child, cache);
    if (result) {
      if (bindingsConflict(binding, result.binding)) {
        // TODO: what to actually do here? just remove the clause?
        throw new Error(`Conflicting builtin results in ${stringifyClause(clause)}`);
      }
      Object.assign(binding, result.binding);
      if (!result.clause) {
        removeClauseSet.add(idx);
      } else {
        newClause.clauses[idx] = result.clause;
      }
    }
  }
  if (removeClauseSet.size > 0) {
    newClause.clauses = newClause.clauses.filter((child, idx): boolean => !removeClauseSet.has(idx));
  }


  for (const side of [ 'positive', 'negative' ] as const) {
    const removeSet = new Set<number>();
    for (const [ idx, quad ] of clause[side].entries()) {
      const builtinBinding = handleBuiltinBind({ root, clause, quad });
      if (builtinBinding) {
        if (bindingsConflict(binding, builtinBinding)) {
          // TODO: what to actually do here? just remove the clause?
          throw new Error(`Conflicting builtin results in ${stringifyClause(clause)}`);
        }
        Object.assign(binding, builtinBinding);
        if (clause.conjunction === (side === 'positive')) {
          removeSet.add(idx);
        }
      }
    }
    if (removeSet.size > 0) {
      newClause[side] = clause[side].filter((child, idx): boolean => !removeSet.has(idx));
    }
  }

  if (!clause.conjunction) {
    cache.add(clause);
  }

  if (Object.keys(binding).length > 0) {
    return {
      binding,
      clause: clause.clauses.length + clause.positive.length + clause.negative.length === 0 ? undefined : newClause,
    }
  }
}

export function bindingsConflict(left: Binding, right: Binding): boolean {
  for (const key of Object.keys(right)) {
    if (left[key] && left[key].value !== right[key].value) {
      return true;
    }
  }
  return false;
}

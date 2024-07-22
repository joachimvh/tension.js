import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { Command, Option } from '@commander-js/extra-typings';
import { loadBuiltins } from './BuiltinUtil';
import {
  findAnswerClauses,
  POSITIVE_NEGATIVE,
  pullGraffitiUp,
  removeDuplicateBlankNodes,
  toClause,
} from './ClauseUtil';
import type { LogLevel } from './LogUtil';
import { getLogger, LOG_LEVELS, setLogLevel } from './LogUtil';
import { parseRoot, stringifyClause, stringifyQuad } from './ParseUtil';
import type { ReasonResult } from './ReasonUtil';
import { reason } from './ReasonUtil';

const logger = getLogger('Run');

export type TensionOptions = {
  maxSteps?: number;
  ignoreAnswer?: boolean;
  logLevel?: LogLevel;
  input: string;
};

export async function runCli(args: string[]): Promise<void> {
  const program = new Command()
    .name('node bin/tension.js')
    .showHelpAfterError()
    .argument('[string]', 'N3 string to parse, or a link to an N3 source, if no file was provided')
    .option('-s, --steps <number>', 'max amount of steps', '5')
    .option('--ignoreAnswer', 'does not stop when an answer surface is resolved')
    .option('-f,--file <string>', 'file to read from')
    .option('-t,--timer', 'runs a timer')
    .addOption(new Option(
      '-l, --logLevel <level>',
      'logger level, currently using info/debug',
    ).choices(LOG_LEVELS).default('info' as const));

  program.parse(args);

  const opts = program.opts();
  if (program.args.length > 1) {
    program.error('Only 1 argument is accepted');
  }
  if (program.args.length > 0 && opts.file) {
    program.error('File option can not be combined with string input');
  }
  if (program.args.length === 0 && !opts.file) {
    program.error('Either a file or string input is required');
  }

  if (opts.timer) {
    console.time('timer');
  }

  let n3: string;
  if (opts.file) {
    n3 = readFileSync(opts.file).toString();
  } else {
    const input = program.args[0];
    n3 = isUrl(input) ? await (await fetch(input)).text() : input;
  }

  // eslint-disable-next-line unused-imports/no-unused-vars
  for await (const result of run({
    input: n3,
    logLevel: opts.logLevel ?? 'info',
    ignoreAnswer: opts.ignoreAnswer,
    maxSteps: opts.steps ? Number.parseInt(opts.steps, 10) : undefined,
  })) {
    // Going through all results to know when to stop timer
  }

  if (opts.timer) {
    console.timeEnd('timer');
  }
}

export async function* run(opts: TensionOptions): AsyncIterableIterator<ReasonResult> {
  setLogLevel(opts.logLevel ?? 'error');

  const parsed = parseRoot(opts.input);
  const formula = pullGraffitiUp(removeDuplicateBlankNodes(parsed));
  const root = toClause(formula);
  await loadBuiltins();

  const answerClauses = opts.ignoreAnswer ? [] : findAnswerClauses(formula);

  logger.debug(`Quantifier levels: ${inspect(root.quantifiers)}`);
  logger.debug(`Starting clause: ${stringifyClause(root)}`);
  // Test framework would otherwise not see triple that is needed and already in root
  for (const side of POSITIVE_NEGATIVE) {
    for (const quad of root[side]) {
      logger.info(`Deduced ${stringifyQuad(quad, side === 'negative')}`);
    }
  }
  yield* reason(root, answerClauses, opts.maxSteps);
}

export function isUrl(input: string): boolean {
  let url;

  try {
    url = new URL(input);
  } catch {
    return false;
  }

  return url.protocol === 'http:' || url.protocol === 'https:';
}

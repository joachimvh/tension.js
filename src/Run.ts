import { Command, Option } from 'commander';
import { readFileSync } from 'fs';
import { inspect } from 'node:util';
import { loadBuiltins } from './BuiltinUtil';
import { findAnswerClauses, pullGraffitiUp, removeDuplicateBlankNodes, toClause } from './ClauseUtil';
import { getLogger, LOG_LEVELS, setLogLevel } from './LogUtil';
import { parseRoot, stringifyClause, stringifyQuad } from './ParseUtil';
import { reason } from './ReasonUtil';

const logger = getLogger('Run');

export async function run(args: string[]): Promise<void> {
  const program = new Command();

  program
    .name('node bin/tension.js')
    .showHelpAfterError()
    .argument('[string]', 'N3 string to parse, or a link to an N3 source, if no file was provided');

  program
    .option('-s, --steps <number>', 'max amount of steps', '5')
    .option('--ignoreAnswer', 'does not stop when an answer surface is resolved')
    .option('-f,--file <string>', 'file to read from')
    .option('-t,--timer', 'runs a timer')
    .addOption(new Option('-l, --logLevel <level>', 'logger level, currently using info/debug').choices(LOG_LEVELS).default('info'));

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

  setLogLevel(opts.logLevel);

  if (opts.timer) {
    console.time('timer');
  }

  const maxSteps = parseInt(opts.steps, 10);
  let n3: string;
  if (opts.file) {
    n3 = readFileSync(opts.file).toString();
  } else {
    const input = program.args[0];
    n3 = isUrl(input) ? await (await fetch(input)).text() : input;
  }

  const parsed = parseRoot(n3);
  const formula = pullGraffitiUp(removeDuplicateBlankNodes(parsed));
  const root = toClause(formula);
  await loadBuiltins();

  let answerClauses = opts.ignoreAnswer ? [] : findAnswerClauses(formula);

  logger.debug(`Quantifier levels: ${inspect(root.quantifiers)}`);
  logger.debug(`Starting clause: ${stringifyClause(root)}`);
  // Test framework would otherwise not see triple that is needed and already in root
  for (const side of [ 'positive', 'negative' ] as const) {
    for (const quad of root[side]) {
      logger.info(`Deduced ${stringifyQuad(quad, side === 'negative')}`);
    }
  }
  reason(root, answerClauses, maxSteps);

  if (opts.timer) {
    console.timeEnd('timer');
  }
}

function isUrl(input: string): boolean {
  let url;

  try {
    url = new URL(input);
  } catch {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

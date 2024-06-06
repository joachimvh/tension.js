import { Command, Option } from 'commander';
import { readFileSync } from 'fs';
import { inspect } from 'node:util';
import { pullGraffitiUp, removeDuplicateBlankNodes, toClause } from './ClauseUtil';
import { getLogger, LOG_LEVELS, setLogLevel } from './LogUtil';
import { findAnswerClause, parseRoot, stringifyClause } from './ParseUtil';
import { reason } from './ReasonUtil';

const logger = getLogger('Run');

export function run(args: string[]): void {
  const program = new Command();
  
  program
    .name('node bin/tension.js')
    .showHelpAfterError()
    .argument('[string]', 'N3 string to parse, if no file was provided');
  
  program
    .option('-s, --steps <number>', 'max amount of steps', '5')
    .option('-a, --answer', 'stop when answer surface is fulfilled')
    .option('-f,--file <string>', 'file to read from')
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
  
  const maxSteps = parseInt(opts.steps, 10);
  const n3 = opts.file ? readFileSync(opts.file).toString() :  program.args[0];

  const parsed = parseRoot(n3);
  const formula = pullGraffitiUp(removeDuplicateBlankNodes(parsed));
  const root = toClause(formula);
  logger.debug(`Quantifier levels: ${inspect(root.quantifiers)}`);
  logger.debug(`Starting clause: ${stringifyClause(root)}`);
  reason(root, findAnswerClause(formula), maxSteps);
}
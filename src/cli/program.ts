import { Command } from 'commander';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { initProject } from '../usecases/init.js';

export interface ProgramDeps {
  clock?: Clock;
  out?: (line: string) => void;
}

export function buildProgram(deps: ProgramDeps = {}): Command {
  const clock = deps.clock ?? systemClock;
  const out = deps.out ?? ((s: string) => process.stdout.write(s + '\n'));

  const program = new Command();
  program.name('apm').description('Agent Project Manager').version('0.1.0');

  program
    .command('init')
    .description('Initialize an APM project in the current directory')
    .option('--dir <path>', 'project directory', process.cwd())
    .action((opts: { dir: string }) => {
      const res = initProject(opts.dir, clock);
      out(res.created ? `APM initialized at ${res.dbPath}` : `APM already initialized at ${res.dbPath}`);
    });

  return program;
}

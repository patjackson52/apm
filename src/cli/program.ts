import { Command } from 'commander';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { initProject } from '../usecases/init.js';
import { runCommand, resolveFormat } from './run.js';
import type { RunDeps } from './run.js';
import type { OutputFormat } from '../format/render.js';
import * as work from '../usecases/work.js';
import * as session from '../usecases/session.js';
import * as lease from '../usecases/lease.js';

export interface ProgramDeps {
  clock?: Clock;
  out?: (line: string) => void;
  defaultFormat?: OutputFormat;
}

export function buildProgram(deps: ProgramDeps = {}): Command {
  const clock = deps.clock ?? systemClock;
  const out = deps.out ?? ((s: string) => process.stdout.write(s + '\n'));

  const program = new Command();
  program.name('apm').description('Agent Project Manager').version('0.1.0');

  program.option('-o, --format <fmt>', 'output format: human|json|yaml|agent');
  program.option('--dir <path>', 'project directory');

  function buildDeps(): RunDeps {
    const g = program.opts() as { format?: string; dir?: string };
    return {
      dir: g.dir,
      clock,
      format: deps.defaultFormat ?? resolveFormat(g.format, process.env, Boolean(process.stdout.isTTY)),
      out,
    };
  }

  program
    .command('init')
    .description('Initialize an APM project in the current directory')
    .option('--dir <path>', 'project directory')
    .action(function (this: Command, opts: { dir?: string }) {
      // Merge local --dir with global --dir (global may have captured it).
      const g = this.optsWithGlobals() as { dir?: string };
      const dir = opts.dir ?? g.dir ?? process.cwd();
      const res = initProject(dir, clock);
      out(res.created ? `APM initialized at ${res.dbPath}` : `APM already initialized at ${res.dbPath}`);
    });

  // --- work command group ---
  const workCmd = program.command('work').description('work items');

  workCmd
    .command('create')
    .description('Create a work item')
    .requiredOption('--type <type>', 'work item type')
    .requiredOption('--title <title>', 'title')
    .option('--description <d>', 'description')
    .option('--priority <n>', 'priority', (v: string) => parseInt(v, 10))
    .option('--estimate <e>', 'estimate (XS|S|M|L|XL)')
    .option('--parent <id>', 'parent work item id')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, o: { type: string; title: string; description?: string; priority?: number; estimate?: string; parent?: string; agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'work create', (ctx) => ({
        data: work.create(ctx, {
          type: o.type as any,
          title: o.title,
          description: o.description,
          priority: o.priority,
          estimate: o.estimate as any,
          parent: o.parent,
          agent: o.agent,
        }),
      }));
    });

  workCmd
    .command('show <id>')
    .description('Show a work item')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'work show', (ctx) => ({
        data: work.show(ctx, id),
      }));
    });

  workCmd
    .command('list')
    .description('List work items')
    .option('--limit <n>', 'max results', (v: string) => parseInt(v, 10))
    .option('--offset <n>', 'offset', (v: string) => parseInt(v, 10))
    .option('--status <s>', 'filter by status')
    .option('--type <t>', 'filter by type')
    .action(function (this: Command, o: { limit?: number; offset?: number; status?: string; type?: string }) {
      process.exitCode = runCommand(buildDeps(), 'work list', (ctx) => ({
        data: work.list(ctx, { limit: o.limit, offset: o.offset, status: o.status, type: o.type }),
      }));
    });

  workCmd
    .command('update <id>')
    .description('Update a work item')
    .option('--title <s>', 'new title')
    .option('--description <s>', 'new description')
    .option('--priority <n>', 'new priority', (v: string) => parseInt(v, 10))
    .option('--estimate <e>', 'new estimate')
    .option('--status <s>', 'new status')
    .option('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { title?: string; description?: string; priority?: number; estimate?: string; status?: string; agent?: string }) {
      process.exitCode = runCommand(buildDeps(), 'work update', (ctx) => ({
        data: work.update(ctx, id, {
          title: o.title,
          description: o.description,
          priority: o.priority,
          estimate: o.estimate as any,
          status: o.status,
        }, o.agent ?? 'unknown'),
      }));
    });

  workCmd
    .command('link <id>')
    .description('Add a dependency link')
    .requiredOption('--depends-on <target>', 'target work item id')
    .option('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { dependsOn: string; agent?: string }) {
      process.exitCode = runCommand(buildDeps(), 'work link', (ctx) => ({
        data: work.link(ctx, id, o.dependsOn, o.agent ?? 'unknown'),
      }));
    });

  workCmd
    .command('children <id>')
    .description('List children of a work item')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'work children', (ctx) => ({
        data: work.children(ctx, id),
      }));
    });

  workCmd
    .command('cancel <id>')
    .description('Cancel a work item (cascades to children)')
    .option('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { agent?: string }) {
      process.exitCode = runCommand(buildDeps(), 'work cancel', (ctx) => ({
        data: work.cancel(ctx, id, o.agent ?? 'unknown'),
      }));
    });

  workCmd
    .command('complete <id>')
    .description('Complete a work item')
    .option('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { agent?: string }) {
      process.exitCode = runCommand(buildDeps(), 'work complete', (ctx) => ({
        data: work.update(ctx, id, { status: 'completed' }, o.agent ?? 'unknown'),
      }));
    });

  // --- session command group ---
  const sessionCmd = program.command('session').description('sessions');

  sessionCmd
    .command('start')
    .description('Start a session')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, o: { agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'session start', (ctx) => ({
        data: session.start(ctx, o.agent),
      }));
    });

  sessionCmd
    .command('show <id>')
    .description('Show a session')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'session show', (ctx) => ({
        data: session.show(ctx, id),
      }));
    });

  sessionCmd
    .command('summarize <id>')
    .description('Record a context summary for a session')
    .requiredOption('--body <text>', 'summary text')
    .action(function (this: Command, id: string, o: { body: string }) {
      process.exitCode = runCommand(buildDeps(), 'session summarize', (ctx) => ({
        data: session.summarize(ctx, id, o.body),
      }));
    });

  sessionCmd
    .command('end <id>')
    .description('End a session')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'session end', (ctx) => ({
        data: session.end(ctx, id),
      }));
    });

  // --- lease command group ---
  const leaseCmd = program.command('lease').description('leases');

  leaseCmd
    .command('acquire <wi>')
    .description('Acquire a lease on a work item')
    .requiredOption('--agent <name>', 'agent name')
    .requiredOption('--ttl <duration>', 'TTL e.g. 30m')
    .option('--session <id>', 'session id')
    .action(function (this: Command, wi: string, o: { agent: string; ttl: string; session?: string }) {
      process.exitCode = runCommand(buildDeps(), 'lease acquire', (ctx) => ({
        data: lease.acquire(ctx, { workItem: wi, agent: o.agent, ttl: o.ttl, session: o.session }),
      }));
    });

  leaseCmd
    .command('heartbeat <id>')
    .description('Extend a lease')
    .requiredOption('--ttl <duration>', 'TTL e.g. 30m')
    .action(function (this: Command, id: string, o: { ttl: string }) {
      process.exitCode = runCommand(buildDeps(), 'lease heartbeat', (ctx) => ({
        data: lease.heartbeat(ctx, id, o.ttl),
      }));
    });

  leaseCmd
    .command('release <id>')
    .description('Release a lease')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'lease release', (ctx) => ({
        data: lease.release(ctx, id),
      }));
    });

  leaseCmd
    .command('expire-stale')
    .description('Expire all stale leases')
    .action(function (this: Command) {
      process.exitCode = runCommand(buildDeps(), 'lease expire-stale', (ctx) => ({
        data: lease.expireStale(ctx),
      }));
    });

  leaseCmd
    .command('list')
    .description('List active leases')
    .option('--agent <name>', 'filter by agent')
    .option('--session <id>', 'filter by session')
    .option('--mine', 'filter to caller agent (requires --agent)')
    .action(function (this: Command, o: { agent?: string; session?: string; mine?: boolean }) {
      process.exitCode = runCommand(buildDeps(), 'lease list', (ctx) => ({
        data: lease.list(ctx, { agent: o.agent, session: o.session, mine: o.mine }),
      }));
    });

  return program;
}

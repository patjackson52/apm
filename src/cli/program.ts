import { readFileSync, copyFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { Command } from 'commander';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { initProject } from '../usecases/init.js';
import { startServer } from '../server/serve.js';
import { runCommand, resolveFormat, resolveProjectRoot } from './run.js';
import type { RunDeps } from './run.js';
import type { OutputFormat } from '../format/render.js';
import * as work from '../usecases/work.js';
import * as session from '../usecases/session.js';
import * as lease from '../usecases/lease.js';
import * as workflow from '../usecases/workflow.js';
import * as run from '../usecases/run.js';
import * as step from '../usecases/step.js';
import * as artifact from '../usecases/artifact.js';
import * as decision from '../usecases/decision.js';
import * as adr from '../usecases/adr.js';
import * as blocker from '../usecases/blocker.js';
import * as gate from '../usecases/gate.js';
import * as policy from '../usecases/policy.js';
import * as prompt from '../usecases/prompt.js';
import * as next from '../usecases/next.js';
import * as statusUc from '../usecases/status.js';
import * as image from '../usecases/image.js';
import { putBlob } from '../storage/blobstore.js';
import { copyImageArgs, openArgs, run as runPlatform } from '../platform/clipboard.js';

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

  program
    .command('serve')
    .description('Run the read-only HTTP API server (bound to 127.0.0.1)')
    .option('-p, --port <n>', 'port', (v) => parseInt(v, 10), 7842)
    .option('--dir <path>', 'project directory')
    .action(function (this: Command, opts: { port: number; dir?: string }) {
      const g = this.optsWithGlobals() as { dir?: string };
      const dir = opts.dir ?? g.dir ?? process.cwd();
      const server = startServer({ dir, clock, port: opts.port });
      server.on('listening', () => {
        const a = server.address();
        const port = typeof a === 'object' && a ? a.port : opts.port;
        out(`apm serve listening on http://127.0.0.1:${port} (project: ${dir})`);
      });
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
    .command('activate <ids...>')
    .description('Attach a workflow + promote to ready so items become dispatchable (batch, idempotent)')
    .option('--workflow <name>', 'workflow to attach', 'feature_delivery')
    .option('--agent <name>', 'agent name')
    .action(function (this: Command, ids: string[], o: { workflow?: string; agent?: string }) {
      process.exitCode = runCommand(buildDeps(), 'work activate', (ctx) => ({
        data: workflow.activate(ctx, { ids, workflow: o.workflow, agent: o.agent ?? 'unknown' }),
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
      process.exitCode = runCommand(buildDeps(), 'work complete', (ctx) => {
        const data = work.update(ctx, id, { status: 'completed' }, o.agent ?? 'unknown');
        // rec #4: auto-activate dependents if policy allows (no-op when flag off)
        workflow.cascadeActivateDependents(ctx, id, o.agent ?? 'unknown');
        return { data };
      });
    });

  workCmd
    .command('current <id>')
    .description('Show current step for a work item (read-only)')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'work current', (ctx) => ({
        data: work.current(ctx, id),
      }));
    });

  workCmd
    .command('blockers <id>')
    .description('Show open blockers and unmet dependencies for a work item')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'work blockers', (ctx) => ({
        data: work.blockers(ctx, id),
      }));
    });

  // --- workflow command group ---
  const workflowCmd = program.command('workflow').description('workflow definitions and runs');

  workflowCmd
    .command('list')
    .description('List workflow definitions')
    .action(function (this: Command) {
      process.exitCode = runCommand(buildDeps(), 'workflow list', (ctx) => ({
        data: workflow.list(ctx),
      }));
    });

  workflowCmd
    .command('show <nameOrId>')
    .description('Show a workflow definition')
    .action(function (this: Command, nameOrId: string) {
      process.exitCode = runCommand(buildDeps(), 'workflow show', (ctx) => ({
        data: workflow.show(ctx, nameOrId),
      }));
    });

  workflowCmd
    .command('attach <workItem>')
    .description('Attach a workflow run to a work item')
    .requiredOption('--workflow <name>', 'workflow name or id')
    .option('--agent <name>', 'agent name')
    .action(function (this: Command, workItem: string, o: { workflow: string; agent?: string }) {
      process.exitCode = runCommand(buildDeps(), 'workflow attach', (ctx) => ({
        data: workflow.attachRun(ctx, { workItem, workflow: o.workflow, agent: o.agent ?? 'unknown' }),
      }));
    });

  workflowCmd
    .command('register')
    .description('Register a workflow definition from a YAML file')
    .requiredOption('--file <path>', 'path to YAML workflow definition file')
    .action(function (this: Command, o: { file: string }) {
      const yaml = readFileSync(o.file, 'utf8');
      process.exitCode = runCommand(buildDeps(), 'workflow register', (ctx) => ({
        data: workflow.register(ctx, yaml),
      }));
    });

  workflowCmd
    .command('runs <workItem>')
    .description('List workflow runs for a work item')
    .action(function (this: Command, workItem: string) {
      process.exitCode = runCommand(buildDeps(), 'workflow runs', (ctx) => ({
        data: workflow.runsForWorkItem(ctx, workItem),
      }));
    });

  // --- run command group ---
  const runCmd = program.command('run').description('workflow run operations');

  runCmd
    .command('cancel <runId>')
    .description('Cancel a workflow run')
    .action(function (this: Command, runId: string) {
      process.exitCode = runCommand(buildDeps(), 'run cancel', (ctx) => ({
        data: run.cancel(ctx, runId),
      }));
    });

  // --- step command group ---
  const stepCmd = program.command('step').description('workflow step operations');

  stepCmd
    .command('complete <runId> <stepId>')
    .description('Complete a workflow step')
    .requiredOption('--agent <name>', 'agent name')
    .option('--artifact <id>', 'artifact id')
    .option('--artifact-type <t>', 'artifact type (creates artifact from --body-file)')
    .option('--body-file <f>', 'path to artifact body file')
    .option('--image-file <path>', 'attach an evidence screenshot (creates IMG + embeds in output doc)')
    .option('--image-kind <k>', 'image kind', 'screenshot')
    .option('--image-alt <s>', 'image alt text')
    .action(function (this: Command, runId: string, stepId: string, o: { agent: string; artifact?: string; artifactType?: string; bodyFile?: string; imageFile?: string; imageKind: string; imageAlt?: string }) {
      const deps = buildDeps();
      const bodyContent = o.bodyFile ? readFileSync(o.bodyFile, 'utf8') : undefined;
      process.exitCode = runCommand(deps, 'step complete', (ctx) => {
        let imageBlob = null;
        if (o.imageFile) {
          const root = resolveProjectRoot(deps.dir);
          imageBlob = putBlob(root, readFileSync(o.imageFile));
        }
        return {
          data: step.complete(ctx, {
            run: runId, step: stepId, agent: o.agent,
            artifactId: o.artifact ?? null,
            artifactType: o.artifactType ?? null,
            bodyFile: bodyContent ?? null,
            imageBlob,
            imageKind: o.imageKind ?? null,
            imageAlt: o.imageAlt ?? null,
          }),
        };
      });
    });

  stepCmd
    .command('fail <runId> <stepId>')
    .description('Fail a workflow step')
    .requiredOption('--reason <text>', 'failure reason')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, runId: string, stepId: string, o: { reason: string; agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'step fail', (ctx) => ({
        data: step.fail(ctx, { run: runId, step: stepId, reason: o.reason, agent: o.agent }),
      }));
    });

  stepCmd
    .command('retry <runId> <stepId>')
    .description('Retry a failed workflow step')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, runId: string, stepId: string, o: { agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'step retry', (ctx) => ({
        data: step.retry(ctx, { run: runId, step: stepId, agent: o.agent }),
      }));
    });

  stepCmd
    .command('revise <runId> <stepId>')
    .description('Re-open a rejected review_gate\'s on_reject source step for revision')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, runId: string, stepId: string, o: { agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'step revise', (ctx) => ({
        data: step.revise(ctx, { run: runId, step: stepId, agent: o.agent }),
      }));
    });

  stepCmd
    .command('review <runId> <stepId>')
    .description('Submit a review verdict for a review_gate step')
    .requiredOption('--reviewer <role>', 'reviewer role')
    .requiredOption('--verdict <v>', 'verdict: pass|reject|abstain')
    .requiredOption('--agent <name>', 'agent name')
    .option('--artifact <id>', 'optional artifact id')
    .action(function (this: Command, runId: string, stepId: string, o: { reviewer: string; verdict: string; agent: string; artifact?: string }) {
      process.exitCode = runCommand(buildDeps(), 'step review', (ctx) => ({
        data: step.review(ctx, {
          run: runId, step: stepId, reviewer: o.reviewer,
          verdict: o.verdict as any, agent: o.agent,
          artifactId: o.artifact ?? null,
        }),
      }));
    });

  // --- artifact command group ---
  const artifactCmd = program.command('artifact').description('artifact operations');

  artifactCmd
    .command('create')
    .description('Create an artifact linked to a work item')
    .requiredOption('--work-item <id>', 'work item id')
    .requiredOption('--type <t>', 'artifact type')
    .requiredOption('--title <s>', 'title')
    .requiredOption('--body-file <f>', 'path to body file')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, o: { workItem: string; type: string; title: string; bodyFile: string; agent: string }) {
      const body = readFileSync(o.bodyFile, 'utf8');
      process.exitCode = runCommand(buildDeps(), 'artifact create', (ctx) => ({
        data: artifact.create(ctx, { workItem: o.workItem, type: o.type as any, title: o.title, body, agent: o.agent }),
      }));
    });

  artifactCmd
    .command('show <id>')
    .description('Show an artifact')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'artifact show', (ctx) => ({
        data: artifact.show(ctx, id),
      }));
    });

  artifactCmd
    .command('revise <id>')
    .description('Revise an artifact (creates new version)')
    .requiredOption('--body-file <f>', 'path to new body file')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { bodyFile: string; agent: string }) {
      const body = readFileSync(o.bodyFile, 'utf8');
      process.exitCode = runCommand(buildDeps(), 'artifact revise', (ctx) => ({
        data: artifact.revise(ctx, id, body, o.agent),
      }));
    });

  artifactCmd
    .command('list')
    .description('List artifacts for a work item')
    .requiredOption('--work-item <id>', 'work item id')
    .action(function (this: Command, o: { workItem: string }) {
      process.exitCode = runCommand(buildDeps(), 'artifact list', (ctx) => ({
        data: artifact.list(ctx, { workItem: o.workItem }),
      }));
    });

  artifactCmd
    .command('submit <id>')
    .description('Submit an artifact for review')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'artifact submit', (ctx) => ({
        data: artifact.submit(ctx, id),
      }));
    });

  artifactCmd
    .command('approve <id>')
    .description('Approve an artifact')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'artifact approve', (ctx) => ({
        data: artifact.approve(ctx, id),
      }));
    });

  artifactCmd
    .command('archive <id>')
    .description('Archive an artifact')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'artifact archive', (ctx) => ({
        data: artifact.archive(ctx, id),
      }));
    });

  // --- decision command group ---
  const decisionCmd = program.command('decision').description('decision operations');

  decisionCmd
    .command('create')
    .description('Create a decision')
    .requiredOption('--work-item <id>', 'work item id')
    .requiredOption('--question <q>', 'decision question')
    .requiredOption('--options <csv>', 'comma-separated options')
    .option('--recommendation <r>', 'recommended option')
    .option('--confidence <n>', 'confidence 0-100', (v: string) => parseInt(v, 10))
    .option('--category <c>', 'decision category')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, o: { workItem: string; question: string; options: string; recommendation?: string; confidence?: number; category?: string; agent: string }) {
      const options = o.options.split(',').map((s) => s.trim()).filter(Boolean);
      process.exitCode = runCommand(buildDeps(), 'decision create', (ctx) => ({
        data: decision.create(ctx, {
          workItem: o.workItem, question: o.question, options,
          recommendation: o.recommendation ?? null,
          confidence: o.confidence ?? null,
          category: o.category ?? null,
          agent: o.agent,
        }),
      }));
    });

  decisionCmd
    .command('accept <id>')
    .description('Accept a decision with a choice')
    .requiredOption('--choice <c>', 'chosen option')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { choice: string; agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'decision accept', (ctx) => ({
        data: decision.accept(ctx, id, o.choice, o.agent),
      }));
    });

  decisionCmd
    .command('reject <id>')
    .description('Reject/cancel a decision')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'decision reject', (ctx) => ({
        data: decision.reject(ctx, id, o.agent),
      }));
    });

  // --- adr command group ---
  const adrCmd = program.command('adr').description('ADR operations');

  adrCmd
    .command('create-from-decision <decId>')
    .description('Create an ADR from a decided decision')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, decId: string, o: { agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'adr create-from-decision', (ctx) => ({
        data: adr.createFromDecision(ctx, decId, o.agent),
      }));
    });

  adrCmd
    .command('list')
    .description('List all ADRs')
    .action(function (this: Command) {
      process.exitCode = runCommand(buildDeps(), 'adr list', (ctx) => ({
        data: adr.list(ctx),
      }));
    });

  adrCmd
    .command('show <id>')
    .description('Show an ADR')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'adr show', (ctx) => ({
        data: adr.show(ctx, id),
      }));
    });

  // --- blocker command group ---
  const blockerCmd = program.command('blocker').description('blocker operations');

  blockerCmd
    .command('create <workItem>')
    .description('Create a blocker on a work item')
    .requiredOption('--type <t>', 'blocker type')
    .requiredOption('--reason <r>', 'reason')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, workItem: string, o: { type: string; reason: string; agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'blocker create', (ctx) => ({
        data: blocker.create(ctx, { workItem, type: o.type, reason: o.reason, agent: o.agent }),
      }));
    });

  blockerCmd
    .command('show <id>')
    .description('Show a blocker (incl. linked bug images)')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'blocker show', (ctx) => ({ data: blocker.show(ctx, id) }));
    });

  blockerCmd
    .command('resolve <id>')
    .description('Resolve a blocker')
    .option('--resolution <r>', 'resolution description')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { resolution?: string; agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'blocker resolve', (ctx) => ({
        data: blocker.resolve(ctx, id, { resolution: o.resolution ?? null, agent: o.agent }),
      }));
    });

  // --- gate command group ---
  const gateCmd = program.command('gate').description('human gate operations');

  gateCmd
    .command('list')
    .description('List open human gates')
    .option('--work-item <id>', 'filter by work item')
    .action(function (this: Command, o: { workItem?: string }) {
      process.exitCode = runCommand(buildDeps(), 'gate list', (ctx) => ({
        data: gate.list(ctx, { workItem: o.workItem ?? null }),
      }));
    });

  gateCmd
    .command('answer <blockerId>')
    .description('Answer a human gate')
    .requiredOption('--choice <c>', 'choice')
    .option('--note <n>', 'optional note')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, blockerId: string, o: { choice: string; note?: string; agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'gate answer', (ctx) => ({
        data: gate.answer(ctx, blockerId, { choice: o.choice, note: o.note ?? null, agent: o.agent }),
      }));
    });

  // --- policy command group ---
  const policyCmd = program.command('policy').description('policy operations');

  policyCmd
    .command('create')
    .description('Create a policy')
    .requiredOption('--scope-type <t>', 'scope type: global|work_item')
    .option('--scope-id <id>', 'scope id (required for work_item scope)')
    .option('--policy-file <f>', 'path to policy JSON file')
    .action(function (this: Command, o: { scopeType: string; scopeId?: string; policyFile?: string }) {
      process.exitCode = runCommand(buildDeps(), 'policy create', (ctx) => ({
        data: policy.create(ctx, { scopeType: o.scopeType, scopeId: o.scopeId ?? null, policyFile: o.policyFile ?? null }),
      }));
    });

  policyCmd
    .command('list')
    .description('List all policies')
    .action(function (this: Command) {
      process.exitCode = runCommand(buildDeps(), 'policy list', (ctx) => ({
        data: policy.list(ctx),
      }));
    });

  policyCmd
    .command('show')
    .description('Show effective policy (optionally for a work item)')
    .option('--work-item <id>', 'show effective policy for this work item')
    .action(function (this: Command, o: { workItem?: string }) {
      process.exitCode = runCommand(buildDeps(), 'policy show', (ctx) => ({
        data: policy.show(ctx, { workItem: o.workItem ?? null }),
      }));
    });

  // --- prompt command group ---
  const promptCmd = program.command('prompt').description('prompt definition operations');

  promptCmd
    .command('create')
    .description('Create a prompt definition')
    .requiredOption('--name <n>', 'prompt name')
    .requiredOption('--body-file <f>', 'path to prompt body file')
    .option('--agent <name>', 'agent name')
    .action(function (this: Command, o: { name: string; bodyFile: string; agent?: string }) {
      process.exitCode = runCommand(buildDeps(), 'prompt create', (ctx) => ({
        data: prompt.create(ctx, { name: o.name, bodyFile: o.bodyFile }),
      }));
    });

  promptCmd
    .command('list')
    .description('List prompt definitions')
    .action(function (this: Command) {
      process.exitCode = runCommand(buildDeps(), 'prompt list', (ctx) => ({
        data: prompt.list(ctx),
      }));
    });

  promptCmd
    .command('revise <name>')
    .description('Add a new version of an existing prompt')
    .requiredOption('--body-file <f>', 'path to prompt body file')
    .action(function (this: Command, name: string, o: { bodyFile: string }) {
      process.exitCode = runCommand(buildDeps(), 'prompt revise', (ctx) => ({
        data: prompt.revise(ctx, { name, bodyFile: o.bodyFile }),
      }));
    });

  promptCmd
    .command('show <name>')
    .description('Show a prompt definition by name')
    .option('--version <n>', 'specific version', (v) => parseInt(v, 10))
    .action(function (this: Command, name: string, o: { version?: number }) {
      process.exitCode = runCommand(buildDeps(), 'prompt show', (ctx) => ({
        data: prompt.show(ctx, name, o.version),
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

  // --- next command ---
  program
    .command('next')
    .description('Dispatch the next work item for an agent')
    .requiredOption('--agent <name>', 'agent name')
    .option('--session <id>', 'session id (or "current")')
    .option('--capabilities <csv>', 'comma-separated capability list')
    .option('--match <mode>', 'capability match mode: any|all (default: any)')
    .option('--acquire', 'atomically acquire a lease on dispatch')
    .option('--ttl <duration>', 'lease TTL e.g. 30m (default: 30m)')
    .action(function (this: Command, o: { agent: string; session?: string; capabilities?: string; match?: string; acquire?: boolean; ttl?: string }) {
      const caps = o.capabilities ? o.capabilities.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const args: next.NextArgs = {
        agent: o.agent,
        capabilities: caps,
        match: (o.match === 'all' ? 'all' : 'any') as 'any' | 'all',
        acquire: o.acquire ?? false,
        session: o.session,
        ttl: o.ttl,
      };
      let nextResult: next.NextResult | undefined;
      const rc = runCommand(buildDeps(), 'next', (ctx) => {
        nextResult = next.next(ctx, args);
        const stale = nextResult.status === 'dispatched' && nextResult.stale ? { stale: true } : undefined;
        return { data: nextResult.data, session: nextResult.session, meta: stale };
      });
      // rc=0 means render succeeded; override exit code with semantic next code
      process.exitCode = rc === 0 ? (nextResult ? next.nextExitCode(nextResult) : 0) : rc;
    });

  // --- image command group ---
  const imageCmd = program.command('image').description('image / screenshot operations');

  imageCmd
    .command('add')
    .description('Ingest an image and link it to a work item')
    .requiredOption('--work-item <id>', 'work item id')
    .requiredOption('--file <path>', 'path to the image file')
    .option('--kind <k>', 'screenshot|mockup|diagram|reference|bug', 'screenshot')
    .option('--alt <s>', 'alt / caption text')
    .option('--capture-file <f>', 'path to a JSON file of capture metadata')
    .option('--relation <r>', 'evidence|reference|bug|produced')
    .option('--blocker <id>', 'attach as bug evidence to a blocker')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, o: { workItem: string; file: string; kind: string; alt?: string; captureFile?: string; relation?: string; blocker?: string; agent: string }) {
      const deps = buildDeps();
      process.exitCode = runCommand(deps, 'image add', (ctx) => {
        const root = resolveProjectRoot(deps.dir);
        const blob = putBlob(root, readFileSync(o.file)); // IO before the txn (C3)
        const capture = o.captureFile ? JSON.parse(readFileSync(o.captureFile, 'utf8')) : undefined;
        return { data: image.add(ctx, { workItem: o.workItem, kind: o.kind, alt: o.alt, capture, relation: o.relation, blocker: o.blocker, agent: o.agent, blob }) };
      });
    });

  imageCmd
    .command('show <id>')
    .description('Show an image (metadata + path; never bytes)')
    .action(function (this: Command, id: string) {
      process.exitCode = runCommand(buildDeps(), 'image show', (ctx) => ({ data: image.show(ctx, id) }));
    });

  imageCmd
    .command('list')
    .description('List images linked to a work item')
    .requiredOption('--work-item <id>', 'work item id')
    .action(function (this: Command, o: { workItem: string }) {
      process.exitCode = runCommand(buildDeps(), 'image list', (ctx) => ({ data: image.list(ctx, { workItem: o.workItem }) }));
    });

  imageCmd
    .command('revise <id>')
    .description('Revise an image (creates a new version in the same lineage)')
    .requiredOption('--file <path>', 'path to the new image file')
    .option('--alt <s>', 'alt / caption text')
    .option('--capture-file <f>', 'path to a JSON file of capture metadata')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, id: string, o: { file: string; alt?: string; captureFile?: string; agent: string }) {
      const deps = buildDeps();
      process.exitCode = runCommand(deps, 'image revise', (ctx) => {
        const blob = putBlob(resolveProjectRoot(deps.dir), readFileSync(o.file)); // IO before the txn (C3)
        const capture = o.captureFile ? JSON.parse(readFileSync(o.captureFile, 'utf8')) : undefined;
        return { data: image.revise(ctx, id, { alt: o.alt, capture, agent: o.agent, blob }) };
      });
    });

  imageCmd
    .command('find')
    .description('Find image(s) referencing a blob hash')
    .requiredOption('--blob <sha256>', 'blob sha256')
    .action(function (this: Command, o: { blob: string }) {
      process.exitCode = runCommand(buildDeps(), 'image find', (ctx) => ({ data: { items: image.find(ctx, o.blob) } }));
    });

  imageCmd
    .command('pair <a> <b>')
    .description('Record a before/after (or other) pairing between two images')
    .option('--kind <k>', 'pair kind', 'before-after')
    .requiredOption('--agent <name>', 'agent name')
    .action(function (this: Command, a: string, b: string, o: { kind: string; agent: string }) {
      process.exitCode = runCommand(buildDeps(), 'image pair', (ctx) => {
        image.pair(ctx, { a, b, kind: o.kind, agent: o.agent });
        return { data: { paired: [a, b], kind: o.kind } };
      });
    });

  imageCmd
    .command('save <id>')
    .description('Write an image\'s bytes to a file')
    .requiredOption('--to <path>', 'destination path')
    .action(function (this: Command, id: string, o: { to: string }) {
      const deps = buildDeps();
      process.exitCode = runCommand(deps, 'image save', (ctx) => {
        const root = resolveProjectRoot(deps.dir);
        const v = image.show(ctx, id);
        copyFileSync(pathJoin(root, v.path), o.to);
        return { data: { id: v.id, saved_to: o.to } };
      });
    });

  imageCmd
    .command('embed <id>')
    .description('Emit a markdown embed snippet (apm:ID, or --resolve for a real path)')
    .option('--resolve', 'emit a real relative blob path for external markdown renderers')
    .action(function (this: Command, id: string, o: { resolve?: boolean }) {
      process.exitCode = runCommand(buildDeps(), 'image embed', (ctx) => {
        const v = image.show(ctx, id);
        const alt = v.alt ?? v.id;
        const target = o.resolve ? v.path : `apm:${v.id}`;
        return { data: { id: v.id, markdown: `![${alt}](${target})` } };
      });
    });

  imageCmd
    .command('copy <id>')
    .description('Copy an image to the OS clipboard (macOS)')
    .action(function (this: Command, id: string) {
      const deps = buildDeps();
      process.exitCode = runCommand(deps, 'image copy', (ctx) => {
        const root = resolveProjectRoot(deps.dir);
        const v = image.show(ctx, id);
        runPlatform(copyImageArgs(process.platform, pathJoin(root, v.path)));
        return { data: { id: v.id, copied: true } };
      });
    });

  imageCmd
    .command('open <id>')
    .description('Open an image in the OS default viewer')
    .action(function (this: Command, id: string) {
      const deps = buildDeps();
      process.exitCode = runCommand(deps, 'image open', (ctx) => {
        const root = resolveProjectRoot(deps.dir);
        const v = image.show(ctx, id);
        runPlatform(openArgs(process.platform, pathJoin(root, v.path)));
        return { data: { id: v.id, opened: true } };
      });
    });

  // --- status command ---
  program
    .command('status')
    .description('Show project status summary')
    .action(function (this: Command) {
      process.exitCode = runCommand(buildDeps(), 'status', (ctx) => ({
        data: statusUc.status(ctx),
      }));
    });

  return program;
}

# WI-42 — Write Actions from the Viewer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the viewer perform writes (answer human gate, run-next, step complete/fail/retry) over a CSRF-guarded write path on the `apm serve` daemon, turning the design-system's "soon" affordances live.

**Architecture:** Add POST action routes to the daemon (mirroring the GET routes) wired to the existing core write usecases; guard all non-GET with a per-listener **CSRF token** (`X-APM-CSRF`) + Origin check, keeping the loopback bind + Host check. Viewer gains an `apiMutate` + TanStack `useMutation` layer (token fetch, optimistic updates, cache invalidation); confirms use the Radix Dialog (ADR-0001 P1).

**Decisions:** ADR-0002 (custom-header+token CSRF · REST action routes · V1 = answer-gate + run-next + step complete/fail/retry). Brainstorm: `docs/superpowers/specs/2026-06-09-write-foundation-design.md`.

**Tech:** TypeScript, node:http serve layer, better-sqlite3, Vitest; viewer = Next App Router + TanStack Query + `@radix-ui/react-dialog`.

---

## Conventions
- Core tests: `npx vitest run tests/path` (repo root). Viewer: `cd viewer && npx vitest run path`. Typecheck: `npm run typecheck` (each). Rebuild `@apm/types` after editing its src before the serve contract test.
- Write usecases already exist — **do not** add domain logic. Read exact arg shapes from `src/usecases/{gate,step,next}.ts` (`AnswerGateArgs`, `CompleteArgs`, `FailArgs`, `RetryArgs`).
- Commit per task.

## File structure
| File | Change |
|---|---|
| `src/server/serve.ts` | mint CSRF token; `GET /api/csrf`; **write guard** (CSRF header + Origin) on non-GET; **body parsing**; V1 POST routes |
| `src/server/router.ts` (or wherever `matchRoute` lives) | no change (already method-aware) — verify |
| `packages/types/src/views.ts` | `CsrfTokenSchema`; reuse `RunViewSchema` for write responses |
| `tests/contract/serve-contract.test.ts` | write-route happy paths + **403 without token** |
| `tests/server/serve-security.test.ts` | CSRF/Origin rejection cases |
| `viewer/lib/api/client.ts` | `apiMutate(path, body)` (POST + `X-APM-CSRF` + envelope) |
| `viewer/lib/api/csrf.ts` + `viewer/lib/api/mutations.ts` | token fetch/cache; `useMutation` hooks + invalidation |
| `viewer/components/...` | wire affordances live (gate answer, run-next, step actions); Radix confirm dialog |

---

## Phase 1 — Serve write transport

### Task 1: CSRF token + `GET /api/csrf` + write guard + body parsing

**Files:** `src/server/serve.ts`. Test: `tests/server/serve-security.test.ts`, `tests/contract/serve-contract.test.ts`.

- [ ] **Step 1 — failing security tests.** Add to `tests/server/serve-security.test.ts` (start the listener as the existing serve tests do):
```ts
it('GET /api/csrf returns a token', async () => {
  const r = await (await fetch(base + '/api/csrf')).json();
  expect(typeof r.data.token).toBe('string'); expect(r.data.token.length).toBeGreaterThan(10);
});
it('a write without the CSRF header is 403', async () => {
  const res = await fetch(base + '/api/work/WI-1/next', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"agent":"x"}' });
  expect(res.status).toBe(403);
});
it('a write with a bad CSRF token is 403', async () => {
  const res = await fetch(base + '/api/work/WI-1/next', { method: 'POST', headers: { 'content-type': 'application/json', 'x-apm-csrf': 'nope' }, body: '{"agent":"x"}' });
  expect(res.status).toBe(403);
});
```
- [ ] **Step 2 — run, expect FAIL** (no /api/csrf; POST → 405 not 403). `npx vitest run tests/server/serve-security.test.ts`
- [ ] **Step 3 — implement in `createListener`.** Mint a token once per listener and add the guard + body parsing.
```ts
import { randomUUID } from 'node:crypto';
// inside createListener, before returning the handler:
const csrfToken = randomUUID();
const LOCALHOST_ORIGINS = (o: string | undefined) => !o || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
```
After the Host check, before route matching, add:
```ts
    // CSRF/Origin guard for writes (read paths unaffected).
    if (req.method !== 'GET' && req.method !== 'OPTIONS') {
      if (req.headers['x-apm-csrf'] !== csrfToken) { writeJson(res, 403, fail(new ApmError('E_VALIDATION', 'bad or missing CSRF token'), buildMeta(cmd, clock))); return; }
      if (!LOCALHOST_ORIGINS(req.headers.origin as string | undefined)) { writeJson(res, 403, fail(new ApmError('E_VALIDATION', 'forbidden origin'), buildMeta(cmd, clock))); return; }
    }
```
Add the CSRF route (handled inline like `/api/projects`, before `matchRoute`):
```ts
    if (url.pathname === '/api/csrf') {
      if (req.method !== 'GET') { writeJson(res, 405, fail(new ApmError('E_VALIDATION', 'method not allowed'), buildMeta(cmd, clock))); return; }
      writeJson(res, 200, ok({ token: csrfToken }, buildMeta(cmd, clock))); return;
    }
```
Add a body reader and make the run-dispatch await it for non-GET. Replace the synchronous `run` dispatch block with:
```ts
    const readBody = (): Promise<unknown> => new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new ApmError('E_VALIDATION', 'invalid JSON body')); } });
      req.on('error', reject);
    });
    let storage: SqliteStorage | undefined;
    try {
      const body = req.method === 'GET' ? undefined : await readBody();
      storage = new SqliteStorage(findProjectDb(projectDir), clock);
      const ctx: Ctx = { storage, clock };
      const data = m.route.run!({ ctx, params: m.params, query: url.searchParams, body });
      writeJson(res, 200, ok(data, buildMeta(cmd, clock)));
    } catch (e) { /* existing catch */ } finally { storage?.close(); }
```
Make the listener callback `async (req, res) => { … }`. Extend the route `RunCtx` type to include `body?: unknown`.
- [ ] **Step 4 — run, expect PASS.** `npx vitest run tests/server/serve-security.test.ts`
- [ ] **Step 5 — commit.** `git add src/server/serve.ts tests/server/serve-security.test.ts && git commit -m "feat(serve): CSRF token + write guard + JSON body parsing"`

### Task 2: V1 POST routes → existing usecases

**Files:** `src/server/serve.ts` (ROUTES), import `* as gate`, `* as step`, `* as next`. Test: `tests/contract/serve-contract.test.ts`.

- [ ] **Step 1 — failing contract test** (the fixture has a work item + run; create a human-gate blocker for the answer case, or assert the run-next path):
```ts
it('POST /api/work/:id/next dispatches (with CSRF)', async () => {
  const tok = (await (await fetch(base + '/api/csrf')).json()).data.token;
  const res = await fetch(`${base}/api/work/${wiId}/next`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-apm-csrf': tok }, body: JSON.stringify({ agent: 'claude' }) });
  expect(res.status).toBe(200);
});
```
- [ ] **Step 2 — run, expect FAIL** (404/405 — route missing).
- [ ] **Step 3 — add routes** to ROUTES (read each usecase's arg shape from its file; bodies map 1:1):
```ts
  { method: 'POST', pattern: '/api/gates/:blocker/answer', run: ({ ctx, params, body }) => gate.answer(ctx, params.blocker, body as any) },
  { method: 'POST', pattern: '/api/work/:id/next', run: ({ ctx, params, body }) => next.next(ctx, { ...(body as any), acquire: true }) },
  { method: 'POST', pattern: '/api/runs/:run/steps/:step/complete', run: ({ ctx, params, body }) => step.complete(ctx, { run: params.run, step: params.step, ...(body as any) }) },
  { method: 'POST', pattern: '/api/runs/:run/steps/:step/fail', run: ({ ctx, params, body }) => step.fail(ctx, { run: params.run, step: params.step, ...(body as any) }) },
  { method: 'POST', pattern: '/api/runs/:run/steps/:step/retry', run: ({ ctx, params, body }) => step.retry(ctx, { run: params.run, step: params.step, ...(body as any) }) },
```
- [ ] **Step 4 — run, expect PASS** + full core suite `npx vitest run` + `npm run typecheck`.
- [ ] **Step 5 — commit.** `git commit -m "feat(serve): V1 write routes (gate answer, run-next, step complete/fail/retry)"`

### Task 3: `@apm/types` — CSRF schema (write responses reuse RunView)
- [ ] Add `export const CsrfTokenSchema = z.object({ token: z.string() }).strict();` to `packages/types/src/views.ts`; rebuild (`npm run build -w @apm/types`). Write responses are `RunView` (already schema'd). Contract test asserts `/api/csrf` against `CsrfTokenSchema` and the write routes against `RunViewSchema`. Commit.

---

## Phase 2 — Viewer mutation layer

### Task 4: `apiMutate` + CSRF token + `useMutation` hooks

**Files:** `viewer/lib/api/client.ts`, `viewer/lib/api/csrf.ts`, `viewer/lib/api/mutations.ts`. Test: `mutations.test.ts`.

- [ ] **Step 1 — failing test** (mock fetch): `apiMutate` POSTs with `X-APM-CSRF` and unwraps the envelope; on `403` it refetches the token once and retries.
- [ ] **Step 2 — run, FAIL.**
- [ ] **Step 3 — implement.** `client.ts`:
```ts
export async function apiMutate<T>(path: string, body: unknown, schema: ZodType<T>, token: string): Promise<T> {
  const res = await fetch(API_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-apm-csrf': token }, body: JSON.stringify(body), credentials: 'omit' });
  const json = await res.json();
  const parsed = envelopeSchema(schema).safeParse(json);
  if (!parsed.success) throw new ApiError('E_CONTRACT', parsed.error.message, res.status);
  const env = parsed.data as { ok: boolean; data: T | null; error: { code: string; message: string } | null };
  if (!env.ok) throw new ApiError(env.error?.code ?? 'E_UNKNOWN', env.error?.message ?? 'write failed', res.status);
  return env.data as T;
}
```
`csrf.ts`: `useCsrfToken()` — a TanStack query for `GET /api/csrf` (cached, `staleTime: Infinity`, refetch on demand). `mutations.ts`: `useAnswerGate()`, `useRunNext(workItemId)`, `useStepAction(run, step, kind)` — each a `useMutation` calling `apiMutate(...)` with the token, `onSuccess` invalidating the relevant query keys (`qk.gates`, `qk.status`, `qk.runs`, `qk.steps`, `qk.workItem`); on `E_CONTRACT`/403 refetch token + retry once.
- [ ] **Step 4 — run, PASS** + `npm run typecheck`.
- [ ] **Step 5 — commit.** `git commit -m "feat(viewer): apiMutate + CSRF token + write mutation hooks"`

### Task 5: Wire the affordances live (gate answer first as the template)

**Files:** the gate/awaiting-human UI, the run/step UI; a `components/ui/ConfirmDialog.tsx` (Radix). Test: per component.

- [ ] **Step 1 — `ConfirmDialog`** on Radix Dialog (token-styled), for destructive/confirmable actions (fail step, run-next).
- [ ] **Step 2 — Answer-gate (template):** replace the disabled "Answer" affordance with a live control → `useAnswerGate()` (choice + optional note), optimistic removal from the awaiting-human list, invalidate `qk.gates`/`qk.status`; error toast on failure. Test the happy path + a 403→retry.
- [ ] **Step 3 — Run-next:** a button on the work item → `useRunNext(id)` (ConfirmDialog), invalidate `qk.runs`/`qk.steps`/`qk.status`.
- [ ] **Step 4 — Step complete/fail/retry:** controls on a manual/integration step in the run graph/popover → `useStepAction(...)`; fail/retry behind ConfirmDialog.
- [ ] **Step 5 — run viewer suite + typecheck; commit.**

### Task 6: Verify end-to-end
- [ ] `cd viewer && npx vitest run && npm run typecheck`; core `npx vitest run && npm run typecheck`; `next build` (prod CSP).
- [ ] Playwright against a live daemon (with a CSRF token): answer a real human gate → it leaves the awaiting-human list; run-next dispatches; assert the write returns 200 and the UI reconciles. 0 hydration/console errors.
- [ ] Commit.

---

## Self-review
- **Decisions covered:** CSRF token + header (T1), Origin check (T1), REST routes (T2), V1 scope = answer-gate/run-next/step complete-fail-retry (T2/T5), reuse RunView (T3), Radix confirm (T5).
- **No domain logic added** — routes wire to existing usecases; idempotency/preconditions are domain-enforced (double-acquire → `E_CONFLICT`, surfaced as a 409 the UI reconciles).
- **Known integration notes:** confirm `matchRoute` returns 405 (not 404) for a known path with a wrong method (so POST routes coexist with GET on shared prefixes); read `AnswerGateArgs`/`CompleteArgs`/`FailArgs`/`RetryArgs` for exact body fields before wiring T2; `next.next` returns a dispatch object (not `RunView`) — give `/api/work/:id/next` its own response schema (or reuse the dispatch shape) rather than `RunViewSchema`.
- **Non-goals:** workflow editor (WI-43), in-UI prompt editing, artifact authoring, auth/multi-user (WI-44).

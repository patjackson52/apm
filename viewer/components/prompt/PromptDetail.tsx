"use client";
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Package,
  History,
  GitCompare,
  GitFork,
  CirclePlay,
  ChevronLeft,
  ChevronRight,
  Check,
  Square,
  CheckSquare,
  Info,
} from 'lucide-react';
import { Skeleton } from '@/components/Skeleton';
import { usePrompt, usePromptUsage } from '@/lib/api/hooks';
import { wordDiff } from '@/lib/prompt/diff';
import { StoredBody } from './StoredBody';
import { EditViaCli } from './EditViaCli';

const PAGE = 20;

function DiffText({ a, b }: { a: string; b: string }) {
  const tokens = useMemo(() => wordDiff(a, b), [a, b]);
  return (
    <>
      {tokens.map((t, i) =>
        t.type === 'eq' ? (
          <span key={i}>{t.text}</span>
        ) : (
          <span key={i} className={t.type === 'add' ? 'diff-add' : 'diff-del'}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

export function PromptDetail({ name }: { name: string }) {
  const { data: def, isLoading, isError } = usePrompt(name);
  const [page, setPage] = useState(0);
  const usage = usePromptUsage(name, { limit: PAGE, offset: page * PAGE });
  const [cmp, setCmp] = useState<number[]>([]);

  if (isLoading) return <Skeleton count={5} />;
  if (isError || !def) return <p>Failed to load prompt.</p>;

  const versions = [...def.versions].sort((a, b) => a.version - b.version);
  const latest =
    versions.find((v) => v.version === def.latest_version) ?? versions[versions.length - 1];
  const latestBody = latest?.body ?? '';

  // default compare selection = previous two versions
  const selection =
    cmp.length === 2
      ? cmp
      : versions.length >= 2
        ? [versions[versions.length - 2]!.version, versions[versions.length - 1]!.version]
        : [];
  const va = versions.find((v) => v.version === selection[0]);
  const vb = versions.find((v) => v.version === selection[1]);

  const toggleCmp = (v: number) => {
    setCmp((prev) => {
      const base = prev.length === 2 ? prev : selection;
      if (base.includes(v)) return base;
      return [base[1]!, v].filter((x) => x != null);
    });
  };

  const total = usage.data?.page.total ?? def.where_runs;
  const items = usage.data?.items ?? [];
  const hasMore = usage.data?.page.has_more ?? false;

  return (
    <div className="page" style={{ padding: 0 }}>
      <div className="pd-head">
        <div>
          <div
            className="row"
            style={{ gap: 6, color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)' }}
          >
            <Link href="/prompts" className="btn btn-ghost btn-sm">
              <ChevronLeft size={13} aria-hidden />
              Prompts
            </Link>
            <span>/</span>
            {def.builtin ? (
              <span className="builtin-badge">
                <Package size={11} aria-hidden />
                Built-in
              </span>
            ) : (
              <span className="custom-badge">Custom</span>
            )}
          </div>
          <h1 className="pd-head__id">
            {def.name}
            <span className="subtle" style={{ fontSize: 'var(--text-lg)', fontWeight: 400 }}>
              @{def.latest_version}
            </span>
          </h1>
          <div className="pd-head__meta">
            <span>{def.summary}</span>
            <span className="subtle">·</span>
            <span className="mono subtle">{def.version_count} versions</span>
            <span className="subtle">·</span>
            <span className="mono subtle">updated {def.updated_at}</span>
          </div>
        </div>
        <div className="pd-head__right">
          <EditViaCli name={def.name} body={latestBody} />
        </div>
      </div>

      <div className="pd-grid">
        <div className="pd-main">
          <StoredBody
            name={def.name}
            version={def.latest_version}
            body={latestBody}
            latest={def.latest_version}
          />

          {va && vb && (
            <section className="card">
              <header className="card__head">
                <h3 className="card__title row" style={{ gap: 8 }}>
                  <GitCompare size={15} className="accent-ink" aria-hidden />
                  Compare versions
                </h3>
                <span
                  className="card__action subtle mono"
                  style={{ fontSize: 'var(--text-2xs)' }}
                >
                  v{va.version} → v{vb.version}
                </span>
              </header>
              <div className="card__body">
                <div className="cmp">
                  <div className="cmp__col">
                    <div className="cmp__colhead">
                      <span>
                        {def.name}@{va.version}
                      </span>
                      <span className="subtle">{va.created_at}</span>
                    </div>
                    <div className="cmp__body">
                      <DiffText a={va.body} b={vb.body} />
                    </div>
                  </div>
                  <div className="cmp__col">
                    <div className="cmp__colhead">
                      <span>
                        {def.name}@{vb.version}
                      </span>
                      <span className="subtle">{vb.created_at}</span>
                    </div>
                    <div className="cmp__body">
                      <DiffText a={va.body} b={vb.body} />
                    </div>
                  </div>
                </div>
                <div className="note">
                  <Info size={13} aria-hidden />
                  <span>
                    <span className="diff-del">Removed</span> and{' '}
                    <span className="diff-add">added</span> words are highlighted. Each version is
                    an immutable snapshot — runs pin the version they dispatched.
                  </span>
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <header className="card__head">
              <h3 className="card__title row" style={{ gap: 8 }}>
                <GitFork size={15} className="accent-ink" aria-hidden />
                Where used
              </h3>
            </header>
            <div className="card__body">
              <div className="wu-summary">
                <span className="wu-stat">
                  <span className="wu-stat__n">{def.where_defs}</span> workflow def
                  {def.where_defs === 1 ? '' : 's'}
                </span>
                <span className="subtle">·</span>
                <span className="wu-stat">
                  <span className="wu-stat__n">{def.where_runs}</span> dispatched runs
                </span>
                <span className="subtle" style={{ fontSize: 'var(--text-xs)' }}>
                  — summarized; drill down below rather than listing every run.
                </span>
              </div>

              {usage.isLoading ? (
                <Skeleton count={3} />
              ) : (
                <div className="wu-list">
                  {items.map((r) => (
                    <div key={r.run} className="wu-row">
                      <CirclePlay size={14} className="subtle" aria-hidden />
                      <div className="wu-row__main">
                        <div className="wu-row__title">{r.run}</div>
                        <div className="wu-row__meta">
                          {r.work_item} · pinned @{r.version}
                          {r.at ? ` · ${r.at}` : ''}
                        </div>
                      </div>
                      <span className={`rs rs--${r.status}`}>
                        <span className="rs__dot" />
                        {r.status}
                      </span>
                    </div>
                  ))}
                  {items.length === 0 && <p className="subtle">No dispatched runs yet.</p>}
                </div>
              )}

              <div className="wu-pager">
                <span className="wu-pager__info">
                  {total === 0 ? 0 : page * PAGE + 1}–{page * PAGE + items.length} of {total}
                </span>
                <span className="pager-btns">
                  <button
                    type="button"
                    className="btn btn-default btn-sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft size={14} aria-hidden />
                    Prev
                  </button>
                  <button
                    type="button"
                    className="btn btn-default btn-sm"
                    disabled={!hasMore}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight size={14} aria-hidden />
                  </button>
                </span>
              </div>
            </div>
          </section>
        </div>

        <div className="pd-side">
          <section className="card">
            <header className="card__head">
              <h3 className="card__title row" style={{ gap: 8 }}>
                <History size={15} className="accent-ink" aria-hidden />
                Versions
              </h3>
              <span className="card__action subtle" style={{ fontSize: 'var(--text-2xs)' }}>
                select two to compare
              </span>
            </header>
            <div className="card__body" style={{ padding: '6px 8px' }}>
              <div className="vhist">
                {[...versions].reverse().map((v) => {
                  const selected = selection.includes(v.version);
                  return (
                    <button
                      key={v.version}
                      type="button"
                      className={`vrow ${selected ? 'is-selected' : ''}`}
                      onClick={() => toggleCmp(v.version)}
                      aria-pressed={selected}
                    >
                      <span className="vrow__check">
                        {selected ? (
                          <CheckSquare size={15} aria-hidden />
                        ) : (
                          <Square size={15} className="subtle" aria-hidden />
                        )}
                      </span>
                      <span className="vrow__ver">v{v.version}</span>
                      <span className="vrow__main">
                        <span className="vrow__at">{v.created_at}</span>
                      </span>
                      {v.version === def.latest_version && (
                        <span className="vrow__tag vrow__tag--latest">latest</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="card">
            <header className="card__head">
              <h3 className="card__title row" style={{ gap: 8 }}>
                <Check size={15} className="accent-ink" aria-hidden />
                Edit this prompt
              </h3>
            </header>
            <div
              className="card__body"
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
            >
              <p className="cli-pop__note" style={{ margin: 0 }}>
                Editing creates <strong>v{def.latest_version + 1}</strong>. Existing runs keep the
                version they pinned; new dispatches use the latest.
              </p>
              <EditViaCli name={def.name} body={latestBody} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

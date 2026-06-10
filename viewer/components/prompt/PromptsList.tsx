"use client";
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MessageSquareText, Package, Search } from 'lucide-react';
import { Skeleton } from '@/components/Skeleton';
import { usePrompts } from '@/lib/api/hooks';

type Filter = 'all' | 'builtin' | 'custom';

const CHIPS: [Filter, string][] = [
  ['all', 'All'],
  ['builtin', 'Built-in'],
  ['custom', 'Custom'],
];

export function PromptsList() {
  const { data, isLoading, isError } = usePrompts();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const items = data ?? [];
    return items.filter((d) => {
      if (filter === 'builtin' && !d.builtin) return false;
      if (filter === 'custom' && d.builtin) return false;
      if (q && !d.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [data, q, filter]);

  if (isLoading) return <Skeleton count={5} />;
  if (isError || !data) return <p>Failed to load prompts.</p>;

  return (
    <div className="page" style={{ padding: 0 }}>
      <div className="plib-toolbar">
        <label className="search">
          <Search size={15} aria-hidden />
          <input
            placeholder="Search prompts by name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search prompts by name"
          />
        </label>
        <div className="chip-row">
          {CHIPS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={`chip-row__btn ${filter === k ? 'is-active' : ''}`}
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="board__spacer" />
        <span className="subtle" style={{ fontSize: 'var(--text-xs)' }}>
          <span className="mono">{rows.length}</span> prompts
        </span>
      </div>

      {rows.length === 0 ? (
        <p>No prompts yet.</p>
      ) : (
        <div className="plib">
          <div className="plib__hrow">
            <span className="plib__hcell">Prompt</span>
            <span className="plib__hcell">Latest</span>
            <span className="plib__hcell">Where used</span>
            <span className="plib__hcell">Updated</span>
            <span className="plib__hcell plib__hcell--r">Source</span>
          </div>
          {rows.map((d) => (
            <Link key={d.name} href={`/prompts/${d.name}`} className="plib__row">
              <span className="plib__name">
                <span className="plib__name-ico">
                  <MessageSquareText size={14} aria-hidden />
                </span>
                <span className="plib__name-main">
                  <span className="plib__name-id">{d.name}</span>
                  <span className="plib__name-sum">{d.summary}</span>
                </span>
              </span>
              <span className="plib__ver">v{d.latest_version}</span>
              <span className="plib__used">
                <span className="mono">{d.where_defs}</span> def{d.where_defs === 1 ? '' : 's'} ·{' '}
                <span className="mono">{d.where_runs}</span> runs
              </span>
              <span className="plib__upd">{d.updated_at}</span>
              <span className="plib__cell--r">
                {d.builtin ? (
                  <span className="builtin-badge">
                    <Package size={11} aria-hidden />
                    Built-in
                  </span>
                ) : (
                  <span className="custom-badge">Custom</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

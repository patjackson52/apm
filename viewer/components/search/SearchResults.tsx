"use client";
import type { SearchResultView } from '@apm/types';
import { useSearch } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { IdLink } from '@/components/dashboard/IdLink';
import { highlight } from '@/lib/search/highlight';
import s from './search.module.css';

const GROUPS: { kind: SearchResultView['kind']; label: string }[] = [
  { kind: 'work_item', label: 'Work items' },
  { kind: 'artifact', label: 'Artifacts' },
  { kind: 'run', label: 'Runs' },
  { kind: 'step', label: 'Steps' },
];

export function SearchResults({ q }: { q: string }) {
  const { data, isLoading, isError } = useSearch(q, { enabled: q.trim().length > 0 });
  if (q.trim().length === 0) return <p className={s.empty}>Type a query to search.</p>;
  if (isLoading) return <Skeleton count={5} />;
  if (isError || !data) return <p className={s.empty}>Search failed.</p>;
  if (data.length === 0) return <p className={s.empty}>No results for &quot;{q}&quot;.</p>;
  return (
    <div className={s.results}>
      {GROUPS.map(({ kind, label }) => {
        const rows = data.filter((r) => r.kind === kind);
        if (rows.length === 0) return null;
        return (
          <section key={kind} className={s.group}>
            <h2>{label}</h2>
            {rows.map((r) => (
              <div key={`${r.kind}:${r.id}`} className={s.row}>
                <IdLink id={r.id} />
                <span className={s.title}>{highlight(r.title, q)}</span>
                {r.snippet ? <span className={s.snippet}>{highlight(r.snippet, q)}</span> : null}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

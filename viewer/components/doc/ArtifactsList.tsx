"use client";
import type { ArtifactView } from '@apm/types';
import { useArtifacts } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { IdLink } from '@/components/dashboard/IdLink';
import s from './ArtifactsList.module.css';

// Display order for the type groups; any unlisted type falls to the end.
const TYPE_ORDER = ['spec', 'plan', 'design', 'decision', 'adr', 'review', 'work_log'];
const rank = (t: string) => { const i = TYPE_ORDER.indexOf(t); return i === -1 ? TYPE_ORDER.length : i; };

/** Project-wide artifact index: current version of every lineage, grouped by type. */
export function ArtifactsList() {
  // Local viewer over a bounded dataset — request enough to show the whole index
  // in one page; surface a note if the server still reports more.
  const { data, isLoading, isError } = useArtifacts({ limit: 500 });
  if (isLoading) return <Skeleton count={6} h={40} />;
  if (isError || !data) return <p>Failed to load artifacts.</p>;
  if (data.items.length === 0) return <p>No artifacts yet.</p>;

  const groups = new Map<string, ArtifactView[]>();
  for (const a of data.items) (groups.get(a.type) ?? groups.set(a.type, []).get(a.type)!).push(a);
  const types = [...groups.keys()].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));

  return (
    <div className={s.groups}>
      <p className={s.total}>
        {data.page.total} artifact{data.page.total === 1 ? '' : 's'}
        {data.page.has_more ? ` (showing ${data.items.length})` : ''}
      </p>
      {types.map((type) => (
        <section key={type} className={s.group}>
          <h2 className={s.heading}>{type} <span className={s.count}>{groups.get(type)!.length}</span></h2>
          <ul className={s.list}>
            {groups.get(type)!.map((a) => (
              <li key={a.id} className={s.row}>
                <IdLink id={a.id} />
                <a className={s.title} href={`/artifacts/${encodeURIComponent(a.id)}`}>{a.title}</a>
                <span className={s.status}>{a.status}</span>
                {a.work_item ? <span className={s.wi}><IdLink id={a.work_item} /></span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

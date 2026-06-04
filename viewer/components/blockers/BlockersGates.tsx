"use client";
import { useBlockers, useGates } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { IdLink } from '@/components/dashboard/IdLink';
import s from './blockers.module.css';

export function BlockersGates() {
  const blockers = useBlockers();
  const gates = useGates();
  if (blockers.isLoading || gates.isLoading) return <Skeleton count={5} />;
  return (
    <div className={s.wrap}>
      <section className={s.section}>
        <h2>Blockers</h2>
        {blockers.isError || !blockers.data ? <p className={s.empty}>Failed to load blockers.</p>
          : blockers.data.length === 0 ? <p className={s.empty}>No blockers.</p>
          : blockers.data.map((b) => (
            <div key={b.id} className={s.row}>
              <IdLink id={b.work_item} />
              <span className={s.type}>{b.type}</span>
              <span>{b.reason}</span>
              <span className={s.muted}>{b.status}</span>
              {b.resolution ? <span className={s.muted}>→ {b.resolution}</span> : null}
            </div>
          ))}
      </section>
      <section className={s.section}>
        <h2>Gates</h2>
        {gates.isError || !gates.data ? <p className={s.empty}>Failed to load gates.</p>
          : gates.data.length === 0 ? <p className={s.empty}>No open gates.</p>
          : gates.data.map((g) => (
            <div key={g.id} className={s.row}>
              <IdLink id={g.work_item} />
              <span>{g.question ?? g.reason}</span>
              {g.options.length > 0 ? <span className={s.muted}>[{g.options.join(', ')}]</span> : null}
              {g.current_step ? <span className={s.muted}>@ {g.current_step}</span> : null}
            </div>
          ))}
      </section>
    </div>
  );
}

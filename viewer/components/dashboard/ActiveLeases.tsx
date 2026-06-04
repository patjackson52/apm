import type { StatusView } from '@apm/types';
import { IdLink } from './IdLink';
import s from './dashboard.module.css';

export function ActiveLeases({ leases }: { leases: StatusView['active_leases'] }) {
  return (
    <section className={s.panel}>
      <h2>Active leases</h2>
      {leases.length === 0 ? <p className={s.empty}>None</p> : leases.map((l) => (
        <div key={l.id} className={s.row}>
          <span>{l.agent}</span>
          <IdLink id={l.work_item} />
          {l.current_step ? <span className={s.muted}>@ {l.current_step}</span> : null}
          <span className={s.muted}>ttl {l.ttl}</span>
        </div>
      ))}
    </section>
  );
}

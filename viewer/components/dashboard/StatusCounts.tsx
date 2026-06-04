import type { StatusView } from '@apm/types';
import s from './dashboard.module.css';

export function StatusCounts({ status }: { status: StatusView }) {
  const entries = Object.entries(status.work.by_status);
  return (
    <section className={s.panel}>
      <h2>Work</h2>
      <div className={s.counts}>
        {entries.map(([st, n]) => (
          <span key={st} className={s.count}>{st}: {n}</span>
        ))}
        <span className={s.count}>ready: {status.ready_count}</span>
      </div>
    </section>
  );
}

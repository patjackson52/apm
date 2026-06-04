import type { StatusView } from '@apm/types';
import { IdLink } from './IdLink';
import s from './dashboard.module.css';

export function ActiveRuns({ runs }: { runs: StatusView['active_runs'] }) {
  return (
    <section className={s.panel}>
      <h2>Active runs</h2>
      {runs.length === 0 ? <p className={s.empty}>None</p> : runs.map((r) => (
        <div key={r.id} className={s.row}>
          <IdLink id={r.work_item} />
          <span className={s.muted}>{r.workflow}</span>
          <span>{r.status}</span>
          {r.current_step ? <span className={s.muted}>@ {r.current_step}</span> : null}
        </div>
      ))}
    </section>
  );
}

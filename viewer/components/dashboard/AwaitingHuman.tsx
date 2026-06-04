import type { StatusView } from '@apm/types';
import { IdLink } from './IdLink';
import s from './dashboard.module.css';

export function AwaitingHuman({ items }: { items: StatusView['awaiting_human'] }) {
  return (
    <section className={s.panel}>
      <h2>Awaiting human</h2>
      {items.length === 0 ? <p className={s.empty}>None</p> : items.map((g) => (
        <div key={g.id} className={s.row}>
          <IdLink id={g.id} />
          <span>{g.reason}</span>
        </div>
      ))}
    </section>
  );
}

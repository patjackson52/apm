import type { DecisionView } from '@apm/types';
import { IdChip } from '@/components/IdChip/IdChip';
import s from './doc.module.css';

/** Structured decision record. All fields are plain-text JSX (no markdown sink). */
export function DecisionDoc({ decision }: { decision: DecisionView }) {
  return (
    <section className={s.card}>
      <header className={s.header}>
        <IdChip id={decision.id} />
        <span className={s.status}>{decision.status}</span>
        {decision.category ? <span className={s.meta}>{decision.category}</span> : null}
      </header>
      <p className={s.field}>
        <span className={s.label}>Question</span>
        {decision.question}
      </p>
      {decision.options.length > 0 ? (
        <div className={s.field}>
          <span className={s.label}>Options</span>
          <ul>
            {decision.options.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {decision.recommendation ? (
        <p className={s.field}>
          <span className={s.label}>Recommendation</span>
          {decision.recommendation}
        </p>
      ) : null}
      {decision.confidence != null ? (
        <p className={s.field}>
          <span className={s.label}>Confidence</span>
          {decision.confidence}%
        </p>
      ) : null}
      {decision.decision ? (
        <p className={s.field}>
          <span className={s.label}>Decision</span>
          {decision.decision}
        </p>
      ) : null}
    </section>
  );
}

import { STEP_STATUS_LABEL } from '@/lib/workflow/statusTint';
import s from './RunLegend.module.css';

const ORDER = ['pending', 'running', 'completed', 'failed', 'skipped'];

/** Legend for run-step status colors. */
export function RunLegend() {
  return (
    <ul className={s.legend} aria-label="Run status legend">
      {ORDER.map((st) => (
        <li key={st} className={s.item}>
          <span className={`${s.dot} ${s[`d_${st}`]}`} aria-hidden="true" />
          {STEP_STATUS_LABEL[st]}
        </li>
      ))}
    </ul>
  );
}

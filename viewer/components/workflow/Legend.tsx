import { STEP_TYPES, STEP_META } from '@/lib/workflow/stepMeta';
import s from './Legend.module.css';

/** Legend covering ALL step types (fixes the design-system mock's omissions). */
export function Legend() {
  return (
    <ul className={s.legend} aria-label="Step type legend">
      {STEP_TYPES.map((t) => (
        <li key={t} className={s.item}>
          <span className={`${s.dot} ${s[`t_${t}`]}`} aria-hidden="true" />
          {STEP_META[t].label}
        </li>
      ))}
    </ul>
  );
}

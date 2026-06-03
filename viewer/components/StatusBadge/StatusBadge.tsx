import s from './StatusBadge.module.css';
import { STATUS_META, type WorkStatus } from '../status';

export function StatusBadge({ status, size = 'md', showDot = true }: { status: WorkStatus; size?: 'sm' | 'md'; showDot?: boolean }) {
  return (
    <span className={`${s.badge} ${s[`s_${status}`]} ${s[size]}`} aria-label={`status: ${STATUS_META[status].label}`}>
      {showDot && <span className={s.dot} aria-hidden="true" />}
      {STATUS_META[status].label}
    </span>
  );
}

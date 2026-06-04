"use client";
import { useLiveStatus } from '@/lib/live/useLiveStatus';
import s from './live.module.css';

const LABEL = { live: 'Live', stale: 'Stale', offline: 'Offline' } as const;

function agoText(lastUpdatedAt: number | null): string {
  if (lastUpdatedAt === null) return '';
  const secs = Math.max(0, Math.round((Date.now() - lastUpdatedAt) / 1000));
  return `updated ${secs}s ago`;
}

/** Compact TopBar liveness widget. */
export function LiveIndicator() {
  const { state, lastUpdatedAt, isFetching } = useLiveStatus();
  const ago = agoText(lastUpdatedAt);
  return (
    <span className={s.indicator} role="status" aria-live="polite">
      <span
        className={`${s.dot} ${s[`d_${state}`]} ${isFetching ? s.pulse : ''}`}
        aria-label={`${LABEL[state]}${ago ? ` — ${ago}` : ''}`}
      />
      <span className={s.label}>{LABEL[state]}</span>
      {ago ? <span className={s.ago}>{ago}</span> : null}
    </span>
  );
}

"use client";
import { useLiveStatus } from '@/lib/live/useLiveStatus';
import s from './live.module.css';

const MESSAGE = { stale: 'Data may be out of date', offline: 'Offline — showing last-known data' } as const;

/** Banner shown when the view is not live, with a Refresh action. Null when live. */
export function StaleBanner() {
  const { state, refresh } = useLiveStatus();
  if (state === 'live') return null;
  return (
    <div className={`${s.banner} ${state === 'offline' ? s.b_offline : s.b_stale}`} role="status">
      <span>{MESSAGE[state]}</span>
      <button type="button" className={s.refresh} onClick={() => refresh()}>Refresh</button>
    </div>
  );
}

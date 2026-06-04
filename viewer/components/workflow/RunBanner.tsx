import s from './RunBanner.module.css';

const FLAGGED = new Set(['paused', 'cancelled', 'blocked']);
const LABEL: Record<string, string> = { paused: 'Run paused', cancelled: 'Run cancelled', blocked: 'Run blocked' };

/** Banner for non-running run states. Nothing for running/completed. */
export function RunBanner({ status }: { status: string }) {
  if (!FLAGGED.has(status)) return null;
  return (
    <div className={`${s.banner} ${s[`b_${status}`] ?? ''}`} role="status">
      {LABEL[status] ?? status}
    </div>
  );
}

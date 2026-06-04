"use client";
import { useSessions } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { IdChip } from '@/components/IdChip/IdChip';
import { Markdown } from '@/components/markdown/Markdown';
import s from './sessions.module.css';

export function SessionsPanel() {
  const { data, isLoading, isError } = useSessions();
  if (isLoading) return <Skeleton count={4} />;
  if (isError || !data) return <p className={s.empty}>Failed to load sessions.</p>;
  if (data.length === 0) return <p className={s.empty}>No sessions yet.</p>;
  return (
    <div className={s.list}>
      {data.map((sess) => (
        <section key={sess.id} className={s.card}>
          <header className={s.head}>
            <IdChip id={sess.id} />
            <span>{sess.agent}</span>
            <span className={s.status}>{sess.status}</span>
            <span className={s.muted}>{sess.started_at.slice(0, 19).replace('T', ' ')}</span>
          </header>
          {sess.context_summary ? <Markdown body={sess.context_summary} /> : <p className={s.muted}>No summary.</p>}
        </section>
      ))}
    </div>
  );
}

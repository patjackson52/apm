"use client";
import { useEvents } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { IdLink } from './IdLink';
import { summarizePayload } from '@/lib/events/summarize';
import s from './dashboard.module.css';

export function ActivityFeed() {
  const { data, isLoading, isError } = useEvents({ limit: 30 });
  return (
    <section className={s.panel}>
      <h2>Activity</h2>
      {isLoading ? <Skeleton count={5} /> : isError || !data ? (
        <p className={s.empty}>Failed to load activity.</p>
      ) : data.items.length === 0 ? (
        <p className={s.empty}>No activity yet.</p>
      ) : (
        <ul className={s.feed}>
          {data.items.map((e) => (
            <li key={e.id} className={s.feedRow}>
              <span className={s.time}>{e.created_at.slice(0, 19).replace('T', ' ')}</span>
              <span className={s.etype}>{e.event_type}</span>
              <IdLink id={e.entity_id} />
              <span className={s.payload}>{summarizePayload(e.payload)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

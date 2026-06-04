"use client";
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import s from './work.module.css';

const STATUSES = ['', 'draft', 'ready', 'active', 'blocked', 'completed', 'cancelled'];
const TYPES = ['', 'project', 'goal', 'milestone', 'feature', 'task', 'subtask', 'bug', 'research', 'human_gate', 'maintenance'];

export function Filters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const set = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.replace(`${pathname}?${p.toString()}`);
  };
  return (
    <div className={s.filters}>
      <label>Status
        <select value={sp.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((v) => <option key={v} value={v}>{v || 'all'}</option>)}
        </select>
      </label>
      <label>Type
        <select value={sp.get('type') ?? ''} onChange={(e) => set('type', e.target.value)}>
          {TYPES.map((v) => <option key={v} value={v}>{v || 'all'}</option>)}
        </select>
      </label>
    </div>
  );
}

"use client";
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useProjects } from '@/lib/api/hooks';
import s from './shell.module.css';

/** Switch the active project across registered projects (read-only, switch-by-id). */
export function ProjectSwitcher() {
  const { data } = useProjects();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const projects = data ?? [];
  const active = sp.get('project') ?? projects.find((p) => p.current)?.id ?? '';

  if (projects.length === 0) return <span className={s.projectName}>apm</span>;

  const onChange = (id: string) => {
    const p = new URLSearchParams(sp.toString());
    if (id) p.set('project', id); else p.delete('project');
    router.replace(`${pathname}?${p.toString()}`);
  };
  return (
    <select aria-label="Switch project" className={s.switchBtn} value={active} onChange={(e) => onChange(e.target.value)}>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}{p.current ? ' (current)' : ''}</option>
      ))}
    </select>
  );
}

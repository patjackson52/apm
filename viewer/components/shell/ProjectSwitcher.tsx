'use client';
import s from './shell.module.css';
export function ProjectSwitcher({ project = 'apm' }: { project?: string }) {
  return (
    <div className={s.switcher}>
      <span className={s.projectName}>{project}</span>
      <button type="button" className={s.switchBtn} disabled title="Multi-project switching is coming soon">
        Multi-project soon
      </button>
    </div>
  );
}

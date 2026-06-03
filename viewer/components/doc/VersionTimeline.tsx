import type { ArtifactView } from '@apm/types';
import s from './doc.module.css';

/** Version history for one document (artifacts sharing a root), newest first. */
export function VersionTimeline({
  versions,
  currentId,
  onSelect,
}: {
  versions: ArtifactView[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  if (versions.length <= 1) return null;
  return (
    <nav className={s.timeline} aria-label="Version history">
      {versions.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`${s.timeRow} ${v.id === currentId ? s.timeRowCurrent : ''}`}
          aria-current={v.id === currentId ? 'true' : undefined}
          onClick={() => onSelect(v.id)}
        >
          <span>v{v.version}</span>
          <span className={s.status}>{v.status}</span>
          <span className={s.meta}>{v.created_at.slice(0, 10)}</span>
        </button>
      ))}
    </nav>
  );
}

import type { ArtifactView } from '@apm/types';
import { Markdown } from '@/components/markdown/Markdown';
import { IdChip } from '@/components/IdChip/IdChip';
import s from './doc.module.css';

/** ADR detail: header + body via the sanitized Markdown renderer (ADRs are artifacts). */
export function AdrDoc({ adr }: { adr: ArtifactView }) {
  return (
    <article>
      <header className={s.header}>
        <IdChip id={adr.id} />
        <strong>{adr.title}</strong>
        <span className={s.status}>{adr.status}</span>
        <span className={s.meta}>{adr.created_at.slice(0, 10)}</span>
      </header>
      <div className={s.reading}>
        <Markdown body={adr.body ?? ''} />
      </div>
    </article>
  );
}

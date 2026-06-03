import type { ArtifactView } from '@apm/types';
import { Markdown } from '@/components/markdown/Markdown';
import { IdChip } from '@/components/IdChip/IdChip';
import { Toc } from './Toc';
import s from './doc.module.css';

/** Renders an artifact/spec/plan/design document: metadata header + sanitized body + TOC. */
export function ArtifactDoc({ artifact }: { artifact: ArtifactView }) {
  const body = artifact.body ?? '';
  return (
    <article>
      <header className={s.header}>
        <IdChip id={artifact.id} />
        <strong>{artifact.title}</strong>
        <span className={s.status}>{artifact.status}</span>
        <span className={s.meta}>
          {artifact.type} · v{artifact.version}
          {artifact.created_by ? ` · ${artifact.created_by}` : ''}
        </span>
      </header>
      <Toc body={body} />
      <div className={s.reading}>
        <Markdown body={body} />
      </div>
    </article>
  );
}

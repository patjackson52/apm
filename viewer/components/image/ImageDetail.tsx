'use client';
import { useState } from 'react';
import { useImage, useImageVersions } from '@/lib/api/hooks';
import { IdChip } from '@/components/IdChip/IdChip';
import { ImageZoom } from './ImageZoom';
import { ImageDiff } from './ImageDiff';
import s from './image.module.css';

export function ImageDetail({ id }: { id: string }) {
  const { data: img, isLoading, isError } = useImage(id);
  const { data: versionsData } = useImageVersions(id);
  const [compareId, setCompareId] = useState('');

  if (isLoading) return <p className={s.empty}>Loading…</p>;
  if (isError || !img) return <p className={s.empty}>Image not found.</p>;

  const versions = versionsData?.items ?? [];
  const compare = versions.find((v) => v.id === compareId);
  const cap = (img.capture ?? {}) as { route?: string; viewport?: { w: number; h: number }; tool?: string; git_sha?: string };

  return (
    <article className={s.panel}>
      <header className={s.controls}>
        <IdChip id={img.id} />
        <strong>{img.alt ?? img.id}</strong>
        <span>{img.kind} · v{img.version}</span>
        {versions.length > 1 && (
          <label>
            Compare with{' '}
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
              <option value="">— none —</option>
              {versions.filter((v) => v.id !== img.id).map((v) => (
                <option key={v.id} value={v.id}>{v.id} (v{v.version})</option>
              ))}
            </select>
          </label>
        )}
      </header>

      {compare ? (
        <ImageDiff beforeBlob={compare.blob} afterBlob={img.blob} beforeAlt={compare.alt ?? compare.id} afterAlt={img.alt ?? img.id} />
      ) : (
        <ImageZoom blob={img.blob} alt={img.alt ?? img.id} />
      )}

      <dl className={s.kv}>
        {img.width != null && img.height != null && (<><dt>dimensions</dt><dd>{img.width}×{img.height}</dd></>)}
        <dt>bytes</dt><dd>{img.byte_size}</dd>
        {cap.route && (<><dt>route</dt><dd>{cap.route}</dd></>)}
        {cap.viewport && (<><dt>viewport</dt><dd>{cap.viewport.w} × {cap.viewport.h}</dd></>)}
        {cap.tool && (<><dt>tool</dt><dd>{cap.tool}</dd></>)}
        {cap.git_sha && (<><dt>git</dt><dd>{cap.git_sha}</dd></>)}
        <dt>created</dt><dd>{img.created_at}</dd>
      </dl>
    </article>
  );
}

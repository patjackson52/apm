'use client';
import Link from 'next/link';
import { useWorkImages } from '@/lib/api/hooks';
import s from './image.module.css';

export function ImagesGallery({ workItemId }: { workItemId: string }) {
  const { data, isLoading, isError } = useWorkImages(workItemId);
  if (isLoading) return <p className={s.empty}>Loading images…</p>;
  if (isError) return <p className={s.empty}>Failed to load images.</p>;
  const items = data?.items ?? [];
  if (items.length === 0) return <p className={s.empty}>No images linked to this work item.</p>;
  return (
    <div className={s.grid}>
      {items.map((img) => (
        <Link key={img.id} href={`/images/${img.id}`} className={s.cell}>
          <img src={`/api/blob/${img.blob}`} alt={img.alt ?? img.id} loading="lazy" referrerPolicy="no-referrer" />
          <div className={s.cap}>{img.alt ?? img.id} · {img.kind}</div>
        </Link>
      ))}
    </div>
  );
}

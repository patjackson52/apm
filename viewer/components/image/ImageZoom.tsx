'use client';
import { useState } from 'react';
import s from './image.module.css';

export function ImageZoom({ blob, alt }: { blob: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className={s.zoomWrap}>
      <img
        src={`/api/blob/${blob}`}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`${s.zoomImg} ${zoomed ? s.zoomed : ''}`}
        onClick={() => setZoomed((z) => !z)}
      />
    </div>
  );
}

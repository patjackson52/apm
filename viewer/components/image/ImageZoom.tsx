'use client';
import { useState } from 'react';
import s from './image.module.css';

export function ImageZoom({ blob, alt }: { blob: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  const toggle = () => setZoomed((z) => !z);
  return (
    <div className={s.zoomWrap}>
      <img
        src={`/api/blob/${blob}`}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`${s.zoomImg} ${zoomed ? s.zoomed : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={zoomed}
        aria-label={zoomed ? `Zoom out ${alt}` : `Zoom in ${alt}`}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        }}
      />
    </div>
  );
}

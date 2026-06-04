'use client';
import { useState } from 'react';
import s from './image.module.css';

type Mode = 'side' | 'swipe' | 'onion';
const src = (b: string) => `/api/blob/${b}`;

export function ImageDiff({ beforeBlob, afterBlob, beforeAlt, afterAlt }:
  { beforeBlob: string; afterBlob: string; beforeAlt: string; afterAlt: string }) {
  const [mode, setMode] = useState<Mode>('side');
  const [pos, setPos] = useState(50); // swipe split % / onion opacity %

  return (
    <div>
      <div className={s.diffModes}>
        <button type="button" onClick={() => setMode('side')} aria-pressed={mode === 'side'}>Side-by-side</button>
        <button type="button" onClick={() => setMode('swipe')} aria-pressed={mode === 'swipe'}>Swipe</button>
        <button type="button" onClick={() => setMode('onion')} aria-pressed={mode === 'onion'}>Onion-skin</button>
      </div>

      {mode === 'side' && (
        <div className={s.sideBySide}>
          <img src={src(beforeBlob)} alt={beforeAlt} loading="lazy" referrerPolicy="no-referrer" />
          <img src={src(afterBlob)} alt={afterAlt} loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}

      {mode === 'onion' && (
        <>
          <div className={s.overlay}>
            <img className={s.base} src={src(beforeBlob)} alt={beforeAlt} referrerPolicy="no-referrer" />
            <img src={src(afterBlob)} alt={afterAlt} style={{ opacity: pos / 100 }} referrerPolicy="no-referrer" />
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="onion opacity" />
        </>
      )}

      {mode === 'swipe' && (
        <>
          <div className={s.overlay}>
            <img className={s.base} src={src(beforeBlob)} alt={beforeAlt} referrerPolicy="no-referrer" />
            <div className={s.clip} style={{ width: `${pos}%` }}>
              <img src={src(afterBlob)} alt={afterAlt} referrerPolicy="no-referrer" />
            </div>
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="swipe split" />
        </>
      )}
    </div>
  );
}

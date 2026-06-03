import s from './Skeleton.module.css';

export function Skeleton({ w = '100%', h = 12, r = 5, count = 1 }: { w?: string | number; h?: number; r?: number; count?: number }) {
  return (
    <span role="presentation" aria-hidden="true" className={s.wrap}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={s.shimmer} style={{ width: w, height: h, borderRadius: r }} />
      ))}
    </span>
  );
}

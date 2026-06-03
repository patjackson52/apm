import { extractToc } from '@/lib/doc/toc';
import s from './doc.module.css';

/** Table of contents derived from markdown headings; anchors match the rendered ids. */
export function Toc({ body }: { body: string }) {
  const entries = extractToc(body);
  if (entries.length === 0) return null;
  return (
    <nav className={s.toc} aria-label="Table of contents">
      <ul>
        {entries.map((e) => (
          <li key={e.href} style={{ paddingLeft: (e.level - 1) * 12 }}>
            <a href={e.href}>{e.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

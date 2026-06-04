import { Fragment, type ReactNode } from 'react';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap case-insensitive matches of `q` in `text` with <mark>, returning plain-text
 * React nodes (strings + <mark>). NO HTML sink: inputs become auto-escaped text
 * children. Used for search results — agent text never reaches dangerouslySetInnerHTML.
 */
export function highlight(text: string, q: string): ReactNode[] {
  const query = q.trim();
  if (!query) return [text];
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'ig'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i}>{part}</mark>
      : <Fragment key={i}>{part}</Fragment>,
  );
}

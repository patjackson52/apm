'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { ComponentProps } from 'react';
import { schema } from './sanitizeSchema';
import s from './Markdown.module.css';

function SafeAnchor({ href, children, ...rest }: ComponentProps<'a'>) {
  const safe = typeof href === 'string' && (href.startsWith('https://') || href.startsWith('#'));
  if (!safe) return <span {...rest}>{children}</span>;
  return <a href={href} rel="noopener noreferrer" target="_blank" {...rest}>{children}</a>;
}

/** The single safe render path for untrusted agent markdown. Sanitizes every body, every render. */
export function Markdown({ body }: { body: string }) {
  return (
    <div className={s.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{ a: SafeAnchor, img: () => null }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

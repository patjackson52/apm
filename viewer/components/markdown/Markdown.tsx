"use client";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { ComponentProps, ReactNode } from 'react';
import { isValidElement } from 'react';
import type { ExtraProps } from 'react-markdown';
import { schema } from './sanitizeSchema';
import { SafeImage } from './SafeImage';
import { Mermaid } from './Mermaid';
import s from './Markdown.module.css';

function SafeAnchor({ href, children, ...rest }: ComponentProps<'a'>) {
  const safe = typeof href === 'string' && (href.startsWith('https://') || href.startsWith('#'));
  if (!safe) return <span {...rest}>{children}</span>;
  return (
    <a href={href} rel="noopener noreferrer" target="_blank" {...rest}>
      {children}
    </a>
  );
}

function flattenText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(flattenText).join('');
  return '';
}

function isMermaidClass(className: unknown): boolean {
  return typeof className === 'string' && className.split(/\s+/).includes('language-mermaid');
}

function CodeBlock({
  className,
  children,
  node,
  ...rest
}: ComponentProps<'code'> & ExtraProps) {
  if (isMermaidClass(className)) {
    const firstChild = node?.children?.[0];
    const fromNode =
      firstChild && firstChild.type === 'text' ? firstChild.value : undefined;
    const chart = typeof fromNode === 'string' ? fromNode : flattenText(children);
    return <Mermaid chart={chart} />;
  }
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
}

// Unwrap the default <pre> wrapper for mermaid fences so the rendered diagram
// is not nested inside a <pre> (invalid + hydration noise). Normal fenced code
// keeps its <pre>.
function Pre({ children, ...rest }: ComponentProps<'pre'>) {
  const first = Array.isArray(children) ? children[0] : children;
  if (isValidElement(first) && isMermaidClass((first.props as { className?: unknown }).className)) {
    return <>{children}</>;
  }
  return <pre {...rest}>{children}</pre>;
}

/** The single safe render path for untrusted agent markdown. Sanitizes every body, every render. */
export function Markdown({ body }: { body: string }) {
  return (
    <div className={s.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{ a: SafeAnchor, img: SafeImage, code: CodeBlock, pre: Pre }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

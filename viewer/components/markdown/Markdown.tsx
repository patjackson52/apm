"use client";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { ComponentProps, ReactNode } from 'react';
import { createElement, isValidElement, useState } from 'react';
import type { ExtraProps } from 'react-markdown';
import { schema } from './sanitizeSchema';
import { SafeImage } from './SafeImage';
import { Mermaid } from './Mermaid';
import { CopyButton } from '@/components/Copy/CopyButton';
import { useClipboard } from '@/lib/clipboard/useClipboard';
import { useShortcuts } from '@/lib/keyboard/useShortcuts';
import { svgToPng } from '@/lib/clipboard/svgToPng';
import { sliceSection } from '@/components/Copy/sectionCopy';
import { tableToMarkdown } from '@/components/Copy/tableToMarkdown';
import { tableToCsv } from '@/components/Copy/tableToCsv';
import { tableModelFromNode } from '@/components/Copy/tableModel';
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

// Mermaid block + a "Copy as image" affordance (rasterizes the sanitized SVG).
function MermaidCopyable({ chart, copyImage, imageSupported }: {
  chart: string;
  copyImage: (b: Blob) => Promise<void>;
  imageSupported: boolean;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  return (
    <div className={s.blockWrap}>
      <Mermaid chart={chart} onReady={setSvg} />
      {svg && imageSupported ? (
        <span className={s.blockActions}>
          <CopyButton label="Copy as image" onCopy={async () => copyImage(await svgToPng(svg))} />
        </span>
      ) : null}
    </div>
  );
}

/** The single safe render path for untrusted agent markdown. Sanitizes every body, every render. */
export function Markdown({ body, docCopy = true }: { body: string; docCopy?: boolean }) {
  const clip = useClipboard();
  useShortcuts({ onCopyDoc: () => clip.copyText(body) });

  function CodeBlock({ className, children, node, ...rest }: ComponentProps<'code'> & ExtraProps) {
    if (isMermaidClass(className)) {
      const firstChild = node?.children?.[0];
      const fromNode = firstChild && firstChild.type === 'text' ? firstChild.value : undefined;
      const chart = typeof fromNode === 'string' ? fromNode : flattenText(children);
      return (
        <MermaidCopyable chart={chart} copyImage={clip.copyImage} imageSupported={clip.imageSupported} />
      );
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  function Pre({ children, ...rest }: ComponentProps<'pre'>) {
    const first = Array.isArray(children) ? children[0] : children;
    if (isValidElement(first)) {
      const props = first.props as { className?: unknown; children?: ReactNode };
      if (isMermaidClass(props.className)) return <>{children}</>;
      const code = flattenText(props.children);
      return (
        <div className={s.blockWrap}>
          <pre {...rest}>{children}</pre>
          <span className={s.blockActions}>
            <CopyButton label="Copy code" onCopy={() => clip.copyText(code)} disabled={!clip.supported} />
          </span>
        </div>
      );
    }
    return <pre {...rest}>{children}</pre>;
  }

  function makeHeading(level: 1 | 2 | 3 | 4) {
    return function Heading({ children, node }: ComponentProps<'h1'> & ExtraProps) {
      const line = node?.position?.start?.line;
      const tag = createElement(`h${level}`, null, children);
      return (
        <div className={s.headingRow}>
          {tag}
          {line ? (
            <CopyButton
              label="Copy section"
              onCopy={() => clip.copyText(sliceSection(body, line))}
              disabled={!clip.supported}
            />
          ) : null}
        </div>
      );
    };
  }

  function Table({ children, node, ...rest }: ComponentProps<'table'> & ExtraProps) {
    const model = tableModelFromNode(node as Parameters<typeof tableModelFromNode>[0]);
    return (
      <div className={s.blockWrap}>
        <table {...rest}>{children}</table>
        <span className={s.blockActions}>
          <CopyButton label="Copy as markdown" onCopy={() => clip.copyText(tableToMarkdown(model))} disabled={!clip.supported} />
          <CopyButton label="Copy as CSV" onCopy={() => clip.copyText(tableToCsv(model))} disabled={!clip.supported} />
        </span>
      </div>
    );
  }

  return (
    <div className={s.prose}>
      {docCopy ? (
        <div className={s.blockActions}>
          <CopyButton label="Copy markdown" onCopy={() => clip.copyText(body)} disabled={!clip.supported} />
        </div>
      ) : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          a: SafeAnchor,
          img: SafeImage,
          code: CodeBlock,
          pre: Pre,
          table: Table,
          h1: makeHeading(1),
          h2: makeHeading(2),
          h3: makeHeading(3),
          h4: makeHeading(4),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

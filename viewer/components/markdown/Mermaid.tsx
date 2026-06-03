"use client";
import { useEffect, useId, useState } from 'react';
import { sanitizeSvg } from '@/lib/security/sanitizeSvg';

type State = { kind: 'pending' } | { kind: 'ok'; svg: string } | { kind: 'error' };

/**
 * Render a Mermaid diagram from untrusted markdown (PLAN.md M2).
 *
 * mermaid runs client-only (needs `document`) and is lazy-imported inside the
 * effect to keep it out of the server/critical bundle. securityLevel:'strict'
 * disables click/JS directives + HTML labels; the rendered SVG is then passed
 * through sanitizeSvg() and only the sanitized string is ever inserted via
 * dangerouslySetInnerHTML. Any parse error / empty sanitized output falls back
 * to the raw fenced source in a <pre> (auto-escaped) — never partial HTML.
 */
export function Mermaid({ chart, onReady }: { chart: string; onReady?: (svg: string) => void }) {
  const rawId = useId();
  const [state, setState] = useState<State>({ kind: 'pending' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          flowchart: { htmlLabels: false },
        });
        const id = 'm' + rawId.replace(/[^a-zA-Z0-9_-]/g, '');
        const { svg } = await mermaid.render(id, chart);
        const safe = sanitizeSvg(svg);
        if (cancelled) return;
        if (safe) {
          setState({ kind: 'ok', svg: safe });
          onReady?.(safe);
        } else {
          setState({ kind: 'error' });
        }
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, rawId, onReady]);

  if (state.kind === 'ok') {
    return <div role="img" dangerouslySetInnerHTML={{ __html: state.svg }} />;
  }
  if (state.kind === 'error') {
    return (
      <figure>
        <pre>
          <code>{chart}</code>
        </pre>
        <figcaption>diagram failed to render</figcaption>
      </figure>
    );
  }
  return <div aria-busy="true" />;
}

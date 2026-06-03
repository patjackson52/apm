import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from './Markdown';

const html = (body: string) => render(<Markdown body={body} />).container;

describe('Markdown — XSS matrix (untrusted agent markdown)', () => {
  it('strips raw <script>', () => {
    expect(html('<script>alert(1)</script>').querySelector('script')).toBeNull();
  });
  it('strips raw <img onerror>', () => {
    const c = html('<img src=x onerror=alert(1)>');
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('[onerror]')).toBeNull();
  });
  it('drops javascript: link href (rendered as non-anchor)', () => {
    const c = html('[click](javascript:alert(1))');
    const a = c.querySelector('a');
    expect(a?.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
  });
  it('drops obfuscated javascript: href', () => {
    for (const v of ['JaVaScRiPt:alert(1)', '  javascript:alert(1)']) {
      const a = html(`[x](${v})`).querySelector('a');
      expect(a?.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
    }
  });
  it('strips data: link href', () => {
    const a = html('[x](data:text/html,<b>1</b>)').querySelector('a');
    expect(a?.getAttribute('href') ?? '').not.toMatch(/^data:/i);
  });
  it('strips <iframe> and <svg onload>', () => {
    expect(html('<iframe src="https://evil"></iframe>').querySelector('iframe')).toBeNull();
    const c = html('<svg onload=alert(1)></svg>');
    expect(c.querySelector('svg')).toBeNull();
  });
  it('strips on* event attributes', () => {
    const c = html('<a href="https://ok" onclick="e()">k</a><b onmouseover=x>y</b>');
    expect(c.querySelector('[onclick]')).toBeNull();
    expect(c.querySelector('[onmouseover]')).toBeNull();
  });
  it('does not emit raw <img> for remote markdown image (deferred to WI-29)', () => {
    expect(html('![a](http://evil/x.png)').querySelector('img')).toBeNull();
  });
});

describe('Markdown — normal render', () => {
  it('renders headings, emphasis, list, code, blockquote, gfm table', () => {
    const c = html('# Title\n\n**b** *i*\n\n- a\n- b\n\n`inline`\n\n```ts\ncode\n```\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(c.querySelector('h1')?.textContent).toBe('Title');
    expect(c.querySelector('strong')?.textContent).toBe('b');
    expect(c.querySelectorAll('li').length).toBe(2);
    expect(c.querySelector('pre code')).toBeTruthy();
    expect(c.querySelector('blockquote')).toBeTruthy();
    expect(c.querySelector('table')).toBeTruthy();
  });
  it('https link gets rel=noopener + target=_blank', () => {
    const a = html('[ok](https://example.com)').querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a?.getAttribute('target')).toBe('_blank');
  });
  it('mermaid fence renders as plain <pre><code class*="language-mermaid"> (deferred to WI-29)', () => {
    const code = html('```mermaid\ngraph TD; A-->B;\n```').querySelector('pre code');
    expect(code?.className).toMatch(/language-mermaid/);
  });
  it('re-sanitizes every body (version independence)', () => {
    expect(html('# Alpha').querySelector('h1')?.textContent).toBe('Alpha');
    expect(html('# Beta').querySelector('h1')?.textContent).toBe('Beta');
  });
});

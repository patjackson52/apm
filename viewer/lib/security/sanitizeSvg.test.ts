import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from './sanitizeSvg';

describe('sanitizeSvg', () => {
  it('drops non-# href / xlink:href but keeps in-doc #refs', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil"><rect/></a>' +
        '<path href="#ok"/><use href="//host"/><image xlink:href="https://e/x.png"/></svg>',
    );
    expect(out).not.toMatch(/evil/);
    expect(out).not.toMatch(/host/);
    expect(out).not.toMatch(/<use/i);
    expect(out).not.toMatch(/<image/i);
    expect(out).not.toMatch(/<a[\s>]/i);
    expect(out).toMatch(/#ok/);
  });

  it('drops whitespace/control-obfuscated javascript: href', () => {
    const out = sanitizeSvg('<svg><path href="  \t javascript:alert(1)"/></svg>');
    expect(out).not.toMatch(/javascript/i);
  });

  it('strips foreignObject, script, on* handlers, and inline style', () => {
    const out = sanitizeSvg(
      '<svg><foreignObject><div onclick="x()">hi</div></foreignObject>' +
        '<script>alert(1)</script>' +
        '<rect onload="x()" onerror="y()" style="background:url(http://e)"/></svg>',
    );
    expect(out).not.toMatch(/foreignObject/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onload|onerror|onclick/i);
    expect(out).not.toMatch(/style=/i);
  });

  it('preserves benign diagram primitives', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0L1 1"/><rect width="2" height="2"/>' +
        '<text>hi</text><marker id="m"/></g></svg>',
    );
    expect(out).toMatch(/<path/i);
    expect(out).toMatch(/<rect/i);
    expect(out).toMatch(/<text/i);
    expect(out).toMatch(/<g[\s>]/i);
  });
});

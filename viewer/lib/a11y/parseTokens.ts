/**
 * Read the theme custom-property blocks out of app/tokens.css so the contrast
 * test asserts the REAL shipped token values (drift-proof). Pure string work;
 * used only at test time. Single-level var() resolution (tokens.css has <=1 hop).
 */

export type TokenMap = Map<string, string>;

/** Extract the `{ ... }` body that follows `selector` in `css`. */
function extractBlock(css: string, selector: string): string {
  const at = css.indexOf(selector);
  if (at === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', at);
  if (open === -1) throw new Error(`no block for selector: ${selector}`);
  // brace-match (token blocks have no nested braces, but match defensively)
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block for selector: ${selector}`);
}

function blockToMap(body: string): TokenMap {
  const map: TokenMap = new Map();
  // linear regex: a custom property name then its value up to the semicolon
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

/** Parse the light + dark theme token blocks from tokens.css text. */
export function parseThemeTokens(css: string): { light: TokenMap; dark: TokenMap } {
  return {
    light: blockToMap(extractBlock(css, '[data-theme="light"]')),
    dark: blockToMap(extractBlock(css, '[data-theme="dark"]')),
  };
}

/** Resolve a token to its hex value, following at most one `var(--x)` hop. */
export function resolveVar(name: string, map: TokenMap): string {
  const v = map.get(name);
  if (v === undefined) throw new Error(`token not defined: ${name}`);
  const m = v.match(/^var\((--[\w-]+)\)$/);
  if (m) {
    const ref = map.get(m[1]!);
    if (ref === undefined || ref.startsWith('var(')) {
      throw new Error(`unresolved var: ${m[1]}`);
    }
    return ref;
  }
  return v;
}

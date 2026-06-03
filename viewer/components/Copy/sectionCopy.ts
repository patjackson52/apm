/**
 * Slice one markdown section from the RAW source (lossless — never the DOM).
 * Fenced-code aware: a line that looks like an ATX heading inside a ``` / ~~~
 * fence is NOT a section boundary (CommonMark: a closing fence must use the
 * same char and be at least as long as the opener).
 */
const FENCE = /^(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s/;

export function sliceSection(markdown: string, headingLine: number): string {
  const lines = markdown.split('\n');
  const startIdx = Math.max(0, headingLine - 1);
  const startMatch = HEADING.exec(lines[startIdx] ?? '');
  const startLevel = startMatch ? startMatch[1]!.length : 6;

  let open: { char: string; len: number } | null = null;
  let end = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = FENCE.exec(line.trimStart());
    if (fence) {
      const run = fence[1]!;
      const char = run[0]!;
      const len = run.length;
      if (!open) {
        open = { char, len };
      } else if (char === open.char && len >= open.len) {
        open = null;
      }
      continue;
    }
    if (!open) {
      const h = HEADING.exec(line);
      if (h && h[1]!.length <= startLevel) {
        end = i;
        break;
      }
    }
  }
  return lines.slice(startIdx, end).join('\n') + '\n';
}

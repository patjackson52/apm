/** Compact, plain-text one-line summary of an arbitrary event payload. Never markup. */
export function summarizePayload(payload: unknown, max = 140): string {
  if (payload === null || payload === undefined) return '';
  let text: string;
  if (typeof payload === 'object') {
    try {
      text = JSON.stringify(payload);
    } catch {
      text = String(payload);
    }
  } else {
    text = String(payload);
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

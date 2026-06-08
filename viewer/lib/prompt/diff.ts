export type DiffToken = { type: 'eq' | 'add' | 'del'; text: string };

/**
 * Word-level diff via LCS. Splits on whitespace (keeping the separators) and
 * emits a single ordered token stream: `eq` for unchanged words, `del` for
 * words only in `a`, `add` for words only in `b`. Ported from the design
 * system's surface_detail wordDiff (which returned split left/right streams).
 */
export function wordDiff(a: string, b: string): DiffToken[] {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: 'eq', text: A[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: A[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: B[j]! });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: A[i]! });
    i++;
  }
  while (j < m) {
    out.push({ type: 'add', text: B[j]! });
    j++;
  }
  return out;
}

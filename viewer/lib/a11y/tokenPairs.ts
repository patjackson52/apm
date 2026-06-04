/**
 * Curated manifest of token (fg,bg) pairs that are ACTUALLY rendered together,
 * each with its WCAG threshold. `text` -> 4.5:1, `ui` (non-text indicator) -> 3:1.
 * Curated (not cartesian) so a failing assertion names a real, meaningful pair.
 * NOTE: run-state bars in StepNode use --fg-muted (the --run-* tokens were removed).
 */

export type Kind = 'text' | 'ui';
export interface Pair {
  fg: string;
  bg: string;
  min: number;
  kind: Kind;
  note: string;
}

const STATUS = ['draft', 'ready', 'active', 'blocked', 'completed', 'cancelled'];

export const TOKEN_PAIRS: Pair[] = [
  // Status badges: each -fg on its own -bg (text on chip).
  ...STATUS.map(
    (s): Pair => ({
      fg: `--status-${s}-fg`,
      bg: `--status-${s}-bg`,
      min: 4.5,
      kind: 'text',
      note: `status ${s} badge`,
    }),
  ),
  { fg: '--gate-fg', bg: '--gate-bg', min: 4.5, kind: 'text', note: 'gate/awaiting badge' },

  // Body + secondary text on the surfaces they appear on.
  { fg: '--fg', bg: '--bg-surface', min: 4.5, kind: 'text', note: 'body text on surface' },
  { fg: '--fg', bg: '--bg-app', min: 4.5, kind: 'text', note: 'body text on app canvas' },
  { fg: '--fg-muted', bg: '--bg-surface', min: 4.5, kind: 'text', note: 'muted text on surface' },
  { fg: '--fg-muted', bg: '--bg-app', min: 4.5, kind: 'text', note: 'muted text on app canvas' },
  { fg: '--code-fg', bg: '--bg-inset', min: 4.5, kind: 'text', note: 'code text on inset' },

  // Non-text UI indicators: focus ring + run-state bars (3:1, WCAG 1.4.11 / 2.4.7).
  { fg: '--accent', bg: '--bg-surface', min: 3.0, kind: 'ui', note: 'focus ring on surface' },
  { fg: '--accent', bg: '--bg-app', min: 3.0, kind: 'ui', note: 'focus ring on app canvas' },
  {
    fg: '--fg-muted',
    bg: '--bg-surface',
    min: 3.0,
    kind: 'ui',
    note: 'run-state bar (pending/skipped) on surface',
  },
];

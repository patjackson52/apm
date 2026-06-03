import type { TableModel } from './tableToMarkdown';

type HastNode = { type?: string; tagName?: string; value?: string; children?: HastNode[] };

function text(n?: HastNode): string {
  if (!n) return '';
  if (n.type === 'text') return n.value ?? '';
  return (n.children ?? []).map(text).join('');
}

function rowsOf(section?: HastNode): string[][] {
  const trs = (section?.children ?? []).filter((c) => c.tagName === 'tr');
  return trs.map((tr) =>
    (tr.children ?? [])
      .filter((c) => c.tagName === 'th' || c.tagName === 'td')
      .map((c) => text(c).trim()),
  );
}

/** Extract a TableModel from a rendered hast <table> node (DOM-free). */
export function tableModelFromNode(node?: HastNode): TableModel {
  const children = node?.children ?? [];
  const thead = children.find((c) => c.tagName === 'thead');
  const tbody = children.find((c) => c.tagName === 'tbody');
  const headers = rowsOf(thead)[0] ?? [];
  const rows = rowsOf(tbody);
  return { headers, rows };
}

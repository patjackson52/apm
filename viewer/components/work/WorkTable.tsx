import type { WorkItemView } from '@apm/types';
import { buildTree, type TreeNode } from './buildTree';
import { StatusBadge } from '@/components/StatusBadge/StatusBadge';
import { IdLink } from '@/components/dashboard/IdLink';
import type { WorkStatus } from '@/components/status';
import s from './work.module.css';

function flatten(nodes: TreeNode[], out: { item: WorkItemView; depth: number }[] = []) {
  for (const n of nodes) { out.push({ item: n.item, depth: n.depth }); flatten(n.children, out); }
  return out;
}

// 'active' is a derived display state (live lease / active run), not a stored status.
function displayStatus(i: WorkItemView): WorkStatus {
  return i.lease || i.active_run ? 'active' : (i.status as WorkStatus);
}

export function WorkTable({ items }: { items: WorkItemView[] }) {
  const rows = flatten(buildTree(items));
  if (rows.length === 0) return <p className={s.empty}>No work items.</p>;
  return (
    <table className={s.table}>
      <thead><tr><th>Item</th><th>Status</th><th>Run</th><th>Deps</th></tr></thead>
      <tbody>
        {rows.map(({ item, depth }) => (
          <tr key={item.id}>
            <td style={{ paddingLeft: 8 + depth * 16 }}>
              <IdLink id={item.id} /> <span className={s.title}>{item.title}</span>
            </td>
            <td><StatusBadge status={displayStatus(item)} size="sm" /></td>
            <td>{item.active_run ? <span className={s.runDot} title={`run ${item.active_run}`} aria-label="running" /> : null}</td>
            <td className={s.muted}>
              {item.depends_on.length > 0 ? `${item.depends_on.length} dep` : ''}
              {item.blocker_ids.length > 0 ? ` · ${item.blocker_ids.length} blk` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

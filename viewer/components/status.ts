export const STORED_STATUSES = ['draft', 'ready', 'blocked', 'completed', 'cancelled'] as const;
// 'active' is NOT a stored status — it is derived from a live lease (apm-core invariant) —
// but it IS a distinct visual state (the kit ships --status-active-* tokens), so the UI
// status vocabulary is the 5 stored statuses + 'active'.
export type WorkStatus = (typeof STORED_STATUSES)[number] | 'active';

export const STATUS_META: Record<WorkStatus, { label: string }> = {
  draft: { label: 'Draft' },
  ready: { label: 'Ready' },
  active: { label: 'Active' },
  blocked: { label: 'Blocked' },
  completed: { label: 'Completed' },
  cancelled: { label: 'Cancelled' },
};

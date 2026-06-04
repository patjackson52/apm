import { IdChip } from '@/components/IdChip/IdChip';
import { hrefForId } from '@/lib/links';

/** IdChip wrapped in a same-origin link when the id has a route; plain chip otherwise. */
export function IdLink({ id }: { id: string }) {
  const href = hrefForId(id);
  return href ? <a href={href}><IdChip id={id} /></a> : <IdChip id={id} />;
}

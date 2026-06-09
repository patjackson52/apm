import Link from 'next/link';
import { IdChip } from '@/components/IdChip/IdChip';
import { hrefForId } from '@/lib/links';

/** IdChip wrapped in a client-side <Link> when the id maps to an in-app route
 *  (via the prefix allowlist); plain chip otherwise. */
export function IdLink({ id }: { id: string }) {
  const href = hrefForId(id);
  return href ? <Link href={href}><IdChip id={id} /></Link> : <IdChip id={id} />;
}

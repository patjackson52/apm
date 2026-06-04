"use client";
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWorkItems } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { Filters } from '@/components/work/Filters';
import { WorkTable } from '@/components/work/WorkTable';

function WorkInner() {
  const sp = useSearchParams();
  const status = sp.get('status') ?? undefined;
  const type = sp.get('type') ?? undefined;
  // 'active' is derived (not a server status) -> filter client-side; server gets the stored statuses only.
  const serverStatus = status === 'active' ? undefined : status;
  const { data, isLoading, isError } = useWorkItems({ status: serverStatus, type, limit: 200 });
  if (isLoading) return <Skeleton count={6} />;
  if (isError || !data) return <p>Failed to load work items.</p>;
  let items = data.items;
  if (status === 'active') items = items.filter((i) => i.lease || i.active_run);
  return (
    <>
      <Filters />
      <WorkTable items={items} />
    </>
  );
}

export default function Page() {
  return (
    <>
      <h1>Work items</h1>
      <Suspense fallback={<Skeleton count={6} />}>
        <WorkInner />
      </Suspense>
    </>
  );
}

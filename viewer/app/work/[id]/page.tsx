import { Suspense } from 'react';
import { Skeleton } from '@/components/Skeleton';
import { WorkDetailTabs } from '@/components/doc/WorkDetailTabs';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton count={4} />}>
      <WorkDetailTabs id={id} />
    </Suspense>
  );
}

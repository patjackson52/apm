import { Suspense } from 'react';
import { Skeleton } from '@/components/Skeleton';
import { PromptDetail } from '@/components/prompt/PromptDetail';

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return (
    <Suspense fallback={<Skeleton count={5} />}>
      <PromptDetail name={decodeURIComponent(name)} />
    </Suspense>
  );
}

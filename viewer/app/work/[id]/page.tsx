import { Skeleton } from '@/components/Skeleton';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><h1>Work item {id}</h1><Skeleton count={4} /><p>screen: WI-31/35</p></>;
}

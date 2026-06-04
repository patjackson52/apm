import { ImageDetail } from '@/components/image/ImageDetail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImageDetail id={id} />;
}

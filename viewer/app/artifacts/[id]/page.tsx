import { ArtifactDetail } from '@/components/doc/ArtifactDetail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ArtifactDetail id={id} />;
}

"use client";
import { useArtifact, useAdr } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { ArtifactDoc } from './ArtifactDoc';
import { AdrDoc } from './AdrDoc';

function NotFound({ id }: { id: string }) {
  return (
    <p>
      Artifact <code>{id}</code> not found. <a href="/artifacts">Back to artifacts</a>.
    </p>
  );
}

function ArtifactInner({ id }: { id: string }) {
  const { data, isLoading, isError } = useArtifact(id);
  if (isLoading) return <Skeleton count={4} h={60} />;
  if (isError || !data) return <NotFound id={id} />;
  return <ArtifactDoc artifact={data} />;
}

function AdrInner({ id }: { id: string }) {
  const { data, isLoading, isError } = useAdr(id);
  if (isLoading) return <Skeleton count={4} h={60} />;
  if (isError || !data) return <NotFound id={id} />;
  return <AdrDoc adr={data} />;
}

/**
 * Standalone artifact/ADR detail page. Deep-linked from search results, step
 * popovers, and id chips (see lib/links: ART- and ADR- both route to /artifacts).
 * ADR ids resolve via the dedicated /api/adr endpoint; everything else via
 * /api/artifacts. Branching by prefix keeps each hook call unconditional.
 */
export function ArtifactDetail({ id }: { id: string }) {
  return id.startsWith('ADR-') ? <AdrInner id={id} /> : <ArtifactInner id={id} />;
}

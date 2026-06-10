"use client";
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useWorkArtifacts, useDecisions, useAdrs } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { groupByRoot } from '@/lib/doc/versions';
import { ArtifactDoc } from './ArtifactDoc';
import { DecisionDoc } from './DecisionDoc';
import { AdrDoc } from './AdrDoc';
import { VersionTimeline } from './VersionTimeline';
import { Tabs, type TabDef } from './Tabs';
import { ImagesGallery } from '@/components/image/ImagesGallery';
import { PromptPanel } from '@/components/prompt/PromptPanel';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'spec', label: 'Spec' },
  { id: 'plan', label: 'Plan' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'adrs', label: 'ADRs' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'images', label: 'Images' },
];

export function WorkDetailTabs({ id }: { id: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const active = sp.get('tab') ?? 'overview';

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set(key, value);
    if (key === 'tab') p.delete('v');
    router.replace(`${pathname}?${p.toString()}`);
  };

  return (
    <>
      <h1>Work item {id}</h1>
      <PromptPanel workItemId={id} />
      <Tabs tabs={TABS} active={active} onChange={(t) => setParam('tab', t)} />
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        {active === 'overview' && <p>Overview of {id}.</p>}
        {(active === 'spec' || active === 'plan' || active === 'artifacts') && (
          <ArtifactsPanel
            id={id}
            type={active === 'artifacts' ? undefined : active}
            selectedId={sp.get('v')}
            onSelect={(v) => setParam('v', v)}
          />
        )}
        {active === 'decisions' && <DecisionsPanel id={id} />}
        {active === 'adrs' && <AdrsPanel />}
        {active === 'images' && <ImagesGallery workItemId={id} />}
      </div>
    </>
  );
}

function ArtifactsPanel({
  id,
  type,
  selectedId,
  onSelect,
}: {
  id: string;
  type?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading, isError } = useWorkArtifacts(id);
  if (isLoading) return <Skeleton count={4} />;
  if (isError || !data) return <p>Failed to load artifacts.</p>;
  const items = data.items.filter((a) => !type || a.type === type);
  if (items.length === 0) return <p>No {type ?? 'artifacts'} yet.</p>;
  const groups = [...groupByRoot(items).values()];
  return (
    <>
      {groups.map((versions) => {
        const current = versions.find((v) => v.id === selectedId) ?? versions[0]!;
        return (
          <div key={current.root}>
            <ArtifactDoc artifact={current} />
            <VersionTimeline versions={versions} currentId={current.id} onSelect={onSelect} />
          </div>
        );
      })}
    </>
  );
}

function DecisionsPanel({ id }: { id: string }) {
  const { data, isLoading, isError } = useDecisions(id);
  if (isLoading) return <Skeleton count={3} />;
  if (isError || !data) return <p>Failed to load decisions.</p>;
  if (data.length === 0) return <p>No decisions yet.</p>;
  return (
    <>
      {data.map((d) => (
        <DecisionDoc key={d.id} decision={d} />
      ))}
    </>
  );
}

function AdrsPanel() {
  const { data, isLoading, isError } = useAdrs();
  if (isLoading) return <Skeleton count={3} />;
  if (isError || !data) return <p>Failed to load ADRs.</p>;
  if (data.items.length === 0) return <p>No ADRs yet.</p>;
  return (
    <>
      {data.items.map((a) => (
        <AdrDoc key={a.id} adr={a} />
      ))}
    </>
  );
}

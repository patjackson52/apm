"use client";
import { FileCode2, ArrowUpCircle } from 'lucide-react';

/**
 * name@version chip linking to the prompt detail page. When the stored prompt
 * has a newer version than the one this run dispatched, append an amber (gate
 * hue, never red) "vN available" badge.
 */
export function ProvenanceChip({
  name,
  version,
  latest,
}: {
  name: string;
  version: number;
  latest: number;
}) {
  const newer = latest > version;
  return (
    <span className="prov">
      <a className="prov-chip" href={`/prompts/${name}`} title={`Open ${name}`}>
        <FileCode2 size={12} aria-hidden />
        <span>
          {name}@{version}
        </span>
      </a>
      {newer && (
        <span className="prov-newer" title={`Newer stored version v${latest} exists`}>
          <ArrowUpCircle size={11} aria-hidden />v{latest} available
        </span>
      )}
    </span>
  );
}

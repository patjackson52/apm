// src/domain/captures.ts
import type { CaptureSpec } from './workflow.js';

/** The minimal image shape the matcher needs: its kind + parsed capture metadata. */
export interface CaptureImage {
  kind: string;
  capture: Record<string, unknown> | null;
}

/** Names of required captures NOT satisfied by any of the supplied images. Pure. */
export function unmetCaptures(required: CaptureSpec[], images: CaptureImage[]): string[] {
  return required.filter((spec) => !images.some((img) => matches(spec, img))).map((spec) => spec.name);
}

function matches(spec: CaptureSpec, img: CaptureImage): boolean {
  if (img.kind !== spec.kind) return false;
  const cap = (img.capture ?? {}) as { route?: string; viewport?: { w: number; h: number } };
  if (spec.route != null && cap.route !== spec.route) return false;
  if (spec.viewport != null) {
    const vp = cap.viewport;
    if (!vp || vp.w !== spec.viewport.w || vp.h !== spec.viewport.h) return false;
  }
  return true;
}

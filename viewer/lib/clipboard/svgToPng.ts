import { sanitizeSvg } from '@/lib/security/sanitizeSvg';

/**
 * Rasterize a Mermaid SVG to a PNG Blob for copy-as-image (PLAN: "Same before
 * copy-as-image"). Re-runs sanitizeSvg FIRST (defense-in-depth) so the drawn
 * SVG has no foreignObject / script / external image|use|href refs — which
 * also keeps the canvas un-tainted, so toBlob succeeds. No network.
 */
export async function svgToPng(svg: string, opts?: { scale?: number }): Promise<Blob> {
  const safe = sanitizeSvg(svg);
  const scale = opts?.scale ?? 1;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safe)}`;
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = (img.width || 100) * scale;
        canvas.height = (img.height || 100) * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no 2d context'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('toBlob produced null'))),
          'image/png',
        );
      } catch (err) {
        reject(err instanceof Error ? err : new Error('rasterize failed'));
      }
    };
    img.onerror = () => reject(new Error('svg failed to load'));
    img.src = url;
  });
}

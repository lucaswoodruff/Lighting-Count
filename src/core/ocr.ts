import { createWorker, PSM, type Worker as TessWorker } from 'tesseract.js';

/**
 * Local OCR for scanned / outlined-text drawings (specs/FUTURE-local-ocr.md).
 *
 * All recognition runs in Tesseract's own Web Worker against assets
 * self-hosted under public/tesseract/ — no network requests at runtime, so
 * the app's drawings-never-leave-the-machine promise holds.
 *
 * Tag recognition follows the pipeline validated by the Phase 0 spike
 * (specs/ocr-spike/): sweep {raw, 2x, 4x+binarize} x {0/90/180/270} x
 * {PSM auto, single-line} and pick the candidate that matches the fixture-tag
 * pattern with the highest confidence. Confidence alone picks garbage; a
 * single preprocessing recipe loses to raw input on clean crops.
 */

export interface OcrCandidate {
  text: string;
  confidence: number; // 0-100 from Tesseract
}

export interface OcrTagResult extends OcrCandidate {
  /** True when the text matches the fixture-tag pattern (e.g. A2, F-3, EM1). */
  isTagShaped: boolean;
}

const TAG_RE = /^[A-Z]{1,3}-?\d{1,3}[A-Z]?$/;

/** Strip everything outside the tag alphabet and uppercase. */
export function normalizeTagText(raw: string): string {
  return raw.replace(/[^A-Z0-9-]/gi, '').toUpperCase();
}

export function looksLikeTag(text: string): boolean {
  return TAG_RE.test(text);
}

/** Tag-shaped candidates always outrank free text; confidence breaks ties. */
export function scoreTagCandidate(c: OcrCandidate): number {
  return (looksLikeTag(c.text) ? 1000 : 0) + c.confidence;
}

/** Pick the best tag candidate, or null when every candidate is empty. */
export function pickBestTagCandidate(candidates: OcrCandidate[]): OcrTagResult | null {
  let best: OcrCandidate | null = null;
  for (const c of candidates) {
    if (!c.text) continue;
    if (!best || scoreTagCandidate(c) > scoreTagCandidate(best)) best = c;
  }
  return best ? { ...best, isTagShaped: looksLikeTag(best.text) } : null;
}

/**
 * Below this text height (px in the crop) the Phase 0 spike showed OCR is
 * unreliable — callers should skip or warn rather than suggest garbage.
 */
export const MIN_RELIABLE_TEXT_PX = 20;

// ---------------------------------------------------------------------------
// Canvas preprocessing (browser only)
// ---------------------------------------------------------------------------

type Drawable = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function scaled(src: Drawable, factor: number, binarize: boolean): HTMLCanvasElement {
  const out = makeCanvas(src.width * factor, src.height * factor);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as CanvasImageSource, 0, 0, out.width, out.height);
  if (binarize) {
    const img = ctx.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3 < 140 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  return out;
}

function rotated(src: HTMLCanvasElement, deg: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (deg === 0) return src;
  const swap = deg !== 180;
  const out = makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

// ---------------------------------------------------------------------------
// Tesseract worker (lazy singleton; assets self-hosted in public/tesseract/)
// ---------------------------------------------------------------------------

let workerPromise: Promise<TessWorker> | null = null;

function getWorker(): Promise<TessWorker> {
  if (!workerPromise) {
    const base = new URL('tesseract/', document.baseURI).toString();
    workerPromise = createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base,
      gzip: true,
    });
  }
  return workerPromise;
}

/** Release the OCR worker and its WASM memory. Safe to call when unused. */
export async function disposeOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) await (await p).terminate();
}

async function recognizeOnce(
  worker: TessWorker,
  image: HTMLCanvasElement,
  psm: PSM,
  whitelist: string,
): Promise<OcrCandidate> {
  await worker.setParameters({
    tessedit_char_whitelist: whitelist,
    tessedit_pageseg_mode: psm,
  });
  const { data } = await worker.recognize(image);
  return { text: normalizeTagText(data.text), confidence: data.confidence };
}

/**
 * OCR a small crop around a suspected fixture tag. Returns the best candidate
 * (a *suggestion* for the user to confirm) or null when nothing was read.
 */
export async function recognizeTagCrop(crop: Drawable): Promise<OcrTagResult | null> {
  const worker = await getWorker();
  const variants = [scaled(crop, 1, false), scaled(crop, 2, false), scaled(crop, 4, true)];
  const candidates: OcrCandidate[] = [];
  for (const variant of variants) {
    for (const deg of [0, 90, 180, 270] as const) {
      const img = rotated(variant, deg);
      for (const psm of [PSM.AUTO, PSM.SINGLE_LINE]) {
        candidates.push(
          await recognizeOnce(worker, img, psm, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'),
        );
      }
    }
  }
  return pickBestTagCandidate(candidates);
}

/**
 * OCR a user-selected schedule-table region. Returns raw text lines for the
 * user to correct before they flow into parseSchedule. Larger grid-aligned
 * text is the easy case; the spike recovered 18/21 words at 3x upscale.
 */
export async function recognizeScheduleRegion(region: Drawable): Promise<string> {
  const worker = await getWorker();
  await worker.setParameters({
    tessedit_char_whitelist: '',
    tessedit_pageseg_mode: PSM.AUTO,
  });
  const results = await Promise.all(
    [scaled(region, 3, false), scaled(region, 3, true)].map((v) => worker.recognize(v)),
  );
  // Prefer the variant Tesseract itself was more confident about.
  results.sort((a, b) => b.data.confidence - a.data.confidence);
  return results[0].data.text.trim();
}

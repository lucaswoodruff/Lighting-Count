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
  const out = makeCanvas(Math.round(src.width * factor), Math.round(src.height * factor));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as CanvasImageSource, 0, 0, out.width, out.height);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  // Contrast-stretch to the full range (faint scans read much better), then
  // optionally binarize — mirrors the normalise/threshold steps the Phase 0
  // spike validated.
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let v = (((d[i] + d[i + 1] + d[i + 2]) / 3 - lo) / range) * 255;
    if (binarize) v = v < 140 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
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

/**
 * The worker is a singleton and recognition parameters are worker-global, so
 * a tag OCR and a schedule OCR running concurrently would interleave their
 * setParameters/recognize pairs. Serialize whole operations through a mutex.
 */
let ocrQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = ocrQueue.then(job, job);
  ocrQueue = run.catch(() => undefined);
  return run;
}

/** Free a scratch canvas's backing store immediately instead of awaiting GC. */
function release(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
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
export function recognizeTagCrop(crop: Drawable): Promise<OcrTagResult | null> {
  return enqueue(async () => {
    const worker = await getWorker();
    const candidates: OcrCandidate[] = [];
    // Variants are built (and released) one at a time — a big crop otherwise
    // holds raw+2x+4x RGBA buffers alive across all 24 recognitions.
    for (const [factor, binarize] of [[1, false], [2, false], [4, true]] as const) {
      const variant = scaled(crop, factor, binarize);
      for (const deg of [0, 90, 180, 270] as const) {
        const img = rotated(variant, deg);
        for (const psm of [PSM.AUTO, PSM.SINGLE_LINE]) {
          candidates.push(
            await recognizeOnce(worker, img, psm, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'),
          );
        }
        if (img !== variant) release(img);
      }
      release(variant);
    }
    return pickBestTagCandidate(candidates);
  });
}

export interface OcrWord {
  text: string;
  confidence: number;
  /** Word-box center in the coordinate space of the input region. */
  center: { x: number; y: number };
}

export interface OcrRegionResult {
  /** Full recognized text (for the user-facing raw view). */
  text: string;
  /** Individual words with positions — feed these through parseSchedule. */
  words: OcrWord[];
  confidence: number;
}

/** Flatten Tesseract's block tree into positioned words (exported for tests). */
export function collectWords(
  blocks: unknown,
  downscale: number,
): OcrWord[] {
  const out: OcrWord[] = [];
  type Bbox = { x0: number; y0: number; x1: number; y1: number };
  type Word = { text: string; confidence: number; bbox: Bbox };
  type Line = { words?: Word[] };
  type Para = { lines?: Line[] };
  type Block = { paragraphs?: Para[] };
  for (const b of (blocks as Block[]) ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          const text = w.text.trim();
          if (!text) continue;
          out.push({
            text,
            confidence: w.confidence,
            center: {
              x: ((w.bbox.x0 + w.bbox.x1) / 2) * downscale,
              y: ((w.bbox.y0 + w.bbox.y1) / 2) * downscale,
            },
          });
        }
      }
    }
  }
  return out;
}

/**
 * OCR a user-selected schedule-table region. Every preprocessing variant is
 * returned (highest Tesseract confidence first) — the caller parses each and
 * keeps whichever yields the best schedule, since Tesseract's own confidence
 * is a poor proxy for table-structure quality. Words carry positions in the
 * input region's coordinate space so the existing column-driven parseSchedule
 * can run on them. Output is a *candidate* the user confirms.
 */
export function recognizeScheduleRegion(region: Drawable): Promise<OcrRegionResult[]> {
  return enqueue(async () => {
    const worker = await getWorker();
    // Aim the OCR input at ~1600 px on the long side (the resolution band the
    // Phase 0 spike validated). The caller's region render is usually already
    // there, so this mostly avoids a second interpolated upscale.
    const factor = Math.min(3, Math.max(1, 1600 / Math.max(region.width, region.height)));
    // Sparse mode reads short isolated cells (the TYPE column) that the page
    // segmenter drops when table grid lines break up its layout analysis.
    // Variants are built one at a time — each is a multi-megapixel canvas.
    const variants: { binarize: boolean; psm: PSM }[] = [
      { binarize: false, psm: PSM.AUTO },
      { binarize: false, psm: PSM.SPARSE_TEXT },
      { binarize: true, psm: PSM.AUTO },
    ];
    const results: OcrRegionResult[] = [];
    for (const v of variants) {
      const image = scaled(region, factor, v.binarize);
      await worker.setParameters({
        tessedit_char_whitelist: '',
        tessedit_pageseg_mode: v.psm,
      });
      const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
      release(image);
      results.push({
        text: data.text.trim(),
        words: collectWords(data.blocks, 1 / factor),
        confidence: data.confidence,
      });
    }
    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  });
}

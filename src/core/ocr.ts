import { PSM, createWorker, type Worker } from 'tesseract.js';
import { isTagCandidate } from './detect';
import type { GrayImage } from './match';
import type { Pt } from '../types';

/**
 * Local, in-browser OCR (Tesseract WASM) for drawings whose text is outlined
 * vectors or a scan. Every asset is self-hosted under public/ocr/, so the
 * app's no-network promise holds: drawings never leave the machine.
 *
 * OCR is applied surgically — small high-resolution crops rendered straight
 * from the PDF vectors, never whole sheets — and its output is always a
 * *suggestion* the user confirms, matching the app's candidates-not-answers
 * trust model.
 *
 * The whitelist deliberately omits I and O: fixture-tag conventions avoid
 * them (confusable with 1 and 0), and excluding them forces Tesseract to
 * read the digit — "F1" instead of "FI".
 */
const TAG_WHITELIST = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789-';

/**
 * Binarization cutoff: drawing text is solid black while grid lines and
 * hatching are gray. Keeping only near-black pixels erases the gridline
 * that so often runs straight through a fixture label.
 */
const INK_THRESHOLD = 120;

function assetUrl(rel: string): string {
  return new URL(import.meta.env.BASE_URL + rel, document.baseURI).href;
}

let workerPromise: Promise<Worker> | null = null;

/**
 * Lazily start the Tesseract worker (first call loads ~6 MB of WASM and
 * model from this app's own origin). Failures reset the singleton so a retry
 * is possible.
 */
export function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    const p = (async () => {
      const worker = await createWorker('eng', 1, {
        workerPath: assetUrl('ocr/worker.min.js'),
        corePath: assetUrl('ocr/core'),
        langPath: assetUrl('ocr/lang'),
      });
      await worker.setParameters({
        tessedit_char_whitelist: TAG_WHITELIST,
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        user_defined_dpi: '300',
      });
      return worker;
    })();
    workerPromise = p;
    p.catch(() => {
      if (workerPromise === p) workerPromise = null;
    });
  }
  return workerPromise;
}

/** Keep only near-black ink; gray linework and hatching become white. */
export function binarize(img: GrayImage, threshold: number = INK_THRESHOLD): GrayImage {
  return {
    data: Float32Array.from(img.data, (v) => (v < threshold ? 0 : 255)),
    width: img.width,
    height: img.height,
  };
}

/** Render a grayscale image to a canvas (optionally upscaled) for OCR. */
export function grayToCanvas(img: GrayImage, scaleUp: number = 1): HTMLCanvasElement {
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  const tctx = tmp.getContext('2d');
  if (!tctx) throw new Error('Canvas 2D context unavailable');
  const id = tctx.createImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i++) {
    const v = img.data[i];
    const p = i * 4;
    id.data[p] = v;
    id.data[p + 1] = v;
    id.data[p + 2] = v;
    id.data[p + 3] = 255;
  }
  tctx.putImageData(id, 0, 0);
  if (scaleUp === 1) return tmp;

  const out = document.createElement('canvas');
  out.width = img.width * scaleUp;
  out.height = img.height * scaleUp;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, 0, 0, out.width, out.height);
  return out;
}

export interface OcrWord {
  text: string;
  /** Center of the word's bounding box, in canvas pixels. */
  cx: number;
  cy: number;
}

/** OCR a canvas and return each recognized word with its position. */
export async function ocrWords(canvas: HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const par of block.paragraphs) {
      for (const line of par.lines) {
        for (const w of line.words) {
          const t = w.text.trim();
          if (t) {
            words.push({
              text: t,
              cx: (w.bbox.x0 + w.bbox.x1) / 2,
              cy: (w.bbox.y0 + w.bbox.y1) / 2,
            });
          }
        }
      }
    }
  }
  return words;
}

/** Letters-then-digits shape (F1, F1E, HA2, K4…) — the canonical tag form. */
const CANONICAL_TAG = /^[A-Z]{1,2}-?\d{1,3}[A-Z]?$/;

/**
 * Pick the fixture-type tag for a symbol at `center`: among tag-shaped
 * words, canonical letters+digits forms (F1E) outrank pure-letter reads
 * (NL, or a stray D from symbol linework); nearer beats farther within the
 * same rank.
 */
export function pickTagNear(words: OcrWord[], center: Pt): string | null {
  let best: { text: string; canonical: boolean; dist: number } | null = null;
  for (const w of words) {
    const t = w.text.toUpperCase();
    if (!isTagCandidate(t)) continue;
    const cand = {
      text: t,
      canonical: CANONICAL_TAG.test(t),
      dist: Math.hypot(w.cx - center.x, w.cy - center.y),
    };
    if (
      !best ||
      (cand.canonical && !best.canonical) ||
      (cand.canonical === best.canonical && cand.dist < best.dist)
    ) {
      best = cand;
    }
  }
  return best?.text ?? null;
}

/** Majority vote across per-crop picks; first-seen wins ties. */
export function voteTag(picks: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const p of picks) {
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [t, n] of counts) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

/**
 * Expand a symbol box outward to catch the tag text that sits next to the
 * symbol (labels are adjacent, not inside). Growth is proportional to the
 * box, floored so tiny boxes still reach nearby text. Page units.
 */
export function expandBox(
  a: Pt,
  b: Pt,
  pageW: number,
  pageH: number,
): { x: number; y: number; w: number; h: number } {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const growX = Math.max(w * 1.25, 30);
  const growY = Math.max(h * 1.25, 20);
  const nx = Math.max(0, x0 - growX);
  const ny = Math.max(0, y0 - growY);
  return {
    x: nx,
    y: ny,
    w: Math.min(pageW - nx, w + growX * 2),
    h: Math.min(pageH - ny, h + growY * 2),
  };
}

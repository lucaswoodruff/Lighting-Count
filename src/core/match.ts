import type { Pt } from '../types';

/**
 * Template matching over a rasterized page, for drawings where fixture tags
 * are vector outlines or scans rather than real text. The user boxes one
 * example symbol; normalized cross-correlation finds every place the page
 * looks the same. Rotated copies are NOT matched.
 */

export interface GrayImage {
  /** Row-major luminance, 0–255. */
  data: Float32Array;
  width: number;
  height: number;
}

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return { data: out, width, height };
}

export function crop(img: GrayImage, x: number, y: number, w: number, h: number): GrayImage {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const cw = Math.min(img.width - x0, Math.floor(w));
  const ch = Math.min(img.height - y0, Math.floor(h));
  if (cw <= 0 || ch <= 0) throw new Error('Crop outside image');
  const out = new Float32Array(cw * ch);
  for (let row = 0; row < ch; row++) {
    out.set(img.data.subarray((y0 + row) * img.width + x0, (y0 + row) * img.width + x0 + cw), row * cw);
  }
  return { data: out, width: cw, height: ch };
}

/** Box-filter downsample by integer factor. */
export function downsample(img: GrayImage, f: number): GrayImage {
  if (f <= 1) return img;
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * img.width + x * f;
        for (let dx = 0; dx < f; dx++) s += img.data[row + dx];
      }
      out[y * w + x] = s / (f * f);
    }
  }
  return { data: out, width: w, height: h };
}

export interface Match {
  /** Center of the matched region, in full-resolution image pixels. */
  center: Pt;
  score: number;
}

interface Peak {
  x: number;
  y: number;
  score: number;
}

/**
 * Find occurrences of `tpl` inside `image` with normalized cross-correlation.
 * Two-stage: a coarse scan at reduced resolution finds candidates, then each
 * is refined at full resolution. Returns matches sorted by score.
 */
export function matchTemplate(image: GrayImage, tpl: GrayImage, threshold = 0.8): Match[] {
  if (tpl.width < 4 || tpl.height < 4) throw new Error('Template too small');
  if (tpl.width > image.width || tpl.height > image.height) {
    throw new Error('Template larger than page');
  }

  // Coarse factor keeps the reduced template around 12px on its short side.
  const f = Math.max(1, Math.floor(Math.min(tpl.width, tpl.height) / 12));
  const cImg = downsample(image, f);
  const cTpl = downsample(tpl, f);

  const peaks = nccScan(cImg, cTpl, threshold * 0.9);
  const kept = nonMaxSuppress(peaks, Math.min(cTpl.width, cTpl.height) * 0.7);

  // Refine each candidate at full resolution.
  const tpl0 = zeroMean(tpl);
  const results: Match[] = [];
  for (const p of kept) {
    const best = refine(image, tpl, tpl0, p.x * f, p.y * f, f + 2);
    if (best && best.score >= threshold) {
      results.push({
        center: { x: best.x + tpl.width / 2, y: best.y + tpl.height / 2 },
        score: best.score,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3000);
}

/** Rotate 90 degrees clockwise: (x, y) -> (h-1-y, x). */
export function rotate90(img: GrayImage): GrayImage {
  const out = new Float32Array(img.width * img.height);
  const w = img.height; // rotated width
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      out[x * w + (img.height - 1 - y)] = img.data[y * img.width + x];
    }
  }
  return { data: out, width: w, height: img.width };
}

export interface TemplateMatchSet {
  matches: Match[];
  tplW: number;
  tplH: number;
}

/**
 * Union the matches of several templates of the SAME symbol (the user boxed
 * multiple examples). A location found by more than one template is kept
 * once, at its best score.
 */
export function mergeMatchSets(sets: TemplateMatchSet[]): Match[] {
  const all = sets.flatMap((s) =>
    s.matches.map((m) => ({ m, r: Math.min(s.tplW, s.tplH) * 0.6 })),
  );
  all.sort((a, b) => b.m.score - a.m.score);
  const kept: { m: Match; r: number }[] = [];
  for (const c of all) {
    const dup = kept.some(
      (k) =>
        Math.hypot(k.m.center.x - c.m.center.x, k.m.center.y - c.m.center.y) <
        Math.min(k.r, c.r),
    );
    if (!dup) kept.push(c);
  }
  return kept.map((k) => k.m);
}

/**
 * Append incoming points that aren't already represented within `radius` of
 * an existing point — re-running a match tops up a type without doubling
 * previously found fixtures.
 */
export function dedupeAppend(existing: Pt[], incoming: Pt[], radius: number): Pt[] {
  const out = [...existing];
  for (const p of incoming) {
    if (out.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= radius)) out.push(p);
  }
  return out;
}

function zeroMean(img: GrayImage): { data: Float32Array; norm: number } {
  let mean = 0;
  for (const v of img.data) mean += v;
  mean /= img.data.length;
  const out = new Float32Array(img.data.length);
  let sq = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = img.data[i] - mean;
    sq += out[i] * out[i];
  }
  return { data: out, norm: Math.sqrt(sq) };
}

/** Full NCC scan of every position (used on the coarse level only). */
function nccScan(img: GrayImage, tpl: GrayImage, threshold: number): Peak[] {
  const { data: t0, norm: tNorm } = zeroMean(tpl);
  if (tNorm < 1e-3) throw new Error('Template has no contrast');
  const tw = tpl.width;
  const th = tpl.height;
  const n = tw * th;

  // Integral images for fast window mean/variance.
  const iw = img.width;
  const sum = new Float64Array((iw + 1) * (img.height + 1));
  const sumSq = new Float64Array((iw + 1) * (img.height + 1));
  for (let y = 0; y < img.height; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < iw; x++) {
      const v = img.data[y * iw + x];
      rowSum += v;
      rowSq += v * v;
      sum[(y + 1) * (iw + 1) + x + 1] = sum[y * (iw + 1) + x + 1] + rowSum;
      sumSq[(y + 1) * (iw + 1) + x + 1] = sumSq[y * (iw + 1) + x + 1] + rowSq;
    }
  }
  const winSum = (x: number, y: number) =>
    sum[(y + th) * (iw + 1) + x + tw] - sum[y * (iw + 1) + x + tw] -
    sum[(y + th) * (iw + 1) + x] + sum[y * (iw + 1) + x];
  const winSq = (x: number, y: number) =>
    sumSq[(y + th) * (iw + 1) + x + tw] - sumSq[y * (iw + 1) + x + tw] -
    sumSq[(y + th) * (iw + 1) + x] + sumSq[y * (iw + 1) + x];

  const peaks: Peak[] = [];
  for (let y = 0; y <= img.height - th; y++) {
    for (let x = 0; x <= iw - tw; x++) {
      const s = winSum(x, y);
      const varN = winSq(x, y) - (s * s) / n;
      // Nearly-flat windows (blank paper) can't match a structured template.
      if (varN < n * 4) continue;
      let dot = 0;
      for (let ty = 0; ty < th; ty++) {
        const irow = (y + ty) * iw + x;
        const trow = ty * tw;
        for (let tx = 0; tx < tw; tx++) dot += img.data[irow + tx] * t0[trow + tx];
      }
      const score = dot / (Math.sqrt(varN) * tNorm);
      if (score >= threshold) peaks.push({ x, y, score });
    }
  }
  return peaks;
}

function nonMaxSuppress(peaks: Peak[], radius: number): Peak[] {
  const sorted = [...peaks].sort((a, b) => b.score - a.score);
  const kept: Peak[] = [];
  for (const p of sorted) {
    if (kept.every((k) => Math.hypot(k.x - p.x, k.y - p.y) >= radius)) kept.push(p);
    if (kept.length >= 3000) break;
  }
  return kept;
}

/** Best full-resolution NCC in a small window around (cx, cy). */
function refine(
  img: GrayImage,
  tpl: GrayImage,
  tpl0: { data: Float32Array; norm: number },
  cx: number,
  cy: number,
  r: number,
): Peak | null {
  const tw = tpl.width;
  const th = tpl.height;
  const n = tw * th;
  let best: Peak | null = null;
  for (let y = Math.max(0, cy - r); y <= Math.min(img.height - th, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(img.width - tw, cx + r); x++) {
      let s = 0;
      let sq = 0;
      let dot = 0;
      for (let ty = 0; ty < th; ty++) {
        const irow = (y + ty) * img.width + x;
        const trow = ty * tw;
        for (let tx = 0; tx < tw; tx++) {
          const v = img.data[irow + tx];
          s += v;
          sq += v * v;
          dot += v * tpl0.data[trow + tx];
        }
      }
      const varN = sq - (s * s) / n;
      if (varN < 1e-3) continue;
      const score = dot / (Math.sqrt(varN) * tpl0.norm);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best;
}

// Phase 0 spike: Tesseract.js accuracy on synthetic drawing crops,
// baseline vs. the mitigations planned in specs/FUTURE-local-ocr.md
// (upscale 4x, char whitelist A-Z0-9-, try 4 rotations, pick best confidence).
import { createWorker, PSM } from "tesseract.js";
import sharp from "sharp";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TAGS_DIR = join(ROOT, "fixtures", process.env.TAGSET || "tags");

const worker = await createWorker("eng", 1, { cachePath: join(ROOT, ".tess-cache") });

const clean = (s) => s.replace(/[^A-Z0-9-]/gi, "").toUpperCase();

async function recognize(buf, opts) {
  await worker.setParameters({
    tessedit_char_whitelist: opts.whitelist ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-" : "",
    tessedit_pageseg_mode: opts.psm ?? PSM.AUTO,
  });
  const { data } = await worker.recognize(buf);
  return { text: clean(data.text), conf: data.confidence };
}

async function upscale(path, factor, binarize = false) {
  const meta = await sharp(path).metadata();
  let s = sharp(path)
    .median(3) // knock down scan noise before scaling
    .resize(meta.width * factor, meta.height * factor, { kernel: "cubic" })
    .normalise();
  if (binarize) s = s.threshold(140);
  return s.png().toBuffer();
}

async function rotations(buf) {
  const out = [buf];
  for (const deg of [90, 180, 270]) out.push(await sharp(buf).rotate(deg).png().toBuffer());
  return out;
}

const files = readdirSync(TAGS_DIR).filter((f) => f.endsWith(".png"));
let baseOK = 0, mitOK = 0;
console.log("tag".padEnd(12), "baseline".padEnd(18), "mitigated");
for (const f of files) {
  const truth = clean(f.split("__")[0]);
  const path = join(TAGS_DIR, f);

  // baseline: raw crop, default settings
  const base = await recognize(readFileSync(path), {});

  // mitigated: 4x upscale + whitelist + PSM single-line + rotation sweep
  // candidates: {2x raw, 4x binarized} x 4 rotations, single-line PSM.
  // Pick by: matches tag pattern first, then confidence.
  const TAG_RE = /^[A-Z]{1,3}-?\d{1,3}[A-Z]?$|^[A-Z]-?\d{1,3}$/;
  const score = (r) => (TAG_RE.test(r.text) ? 1000 : 0) + r.conf;
  let best = { text: "", conf: -1 };
  const variants = [readFileSync(path), await upscale(path, 2, false), await upscale(path, 4, true)];
  for (const variant of variants) {
    for (const rbuf of await rotations(variant)) {
      for (const psm of [PSM.AUTO, PSM.SINGLE_LINE]) {
        const r = await recognize(rbuf, { whitelist: true, psm });
        if (r.text && score(r) > score(best)) best = r;
      }
    }
  }

  const b = base.text === truth, m = best.text === truth;
  baseOK += b; mitOK += m;
  console.log(
    f.padEnd(12),
    `${base.text || "∅"} (${Math.round(base.conf)}) ${b ? "✓" : "✗"}`.padEnd(18),
    `${best.text || "∅"} (${Math.round(best.conf)}) ${m ? "✓" : "✗"}`
  );
}
console.log(`\ntags: baseline ${baseOK}/${files.length}, mitigated ${mitOK}/${files.length}`);

// --- schedule region (larger grid text) ---
const schedPath = join(ROOT, "fixtures", "schedule", "schedule.png");
const truthWords = readFileSync(join(ROOT, "fixtures", "schedule", "schedule.truth.txt"), "utf8")
  .split(/\s+/).filter(Boolean).map(clean);
await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: PSM.AUTO });
const got = new Set();
for (const variant of [await upscale(schedPath, 3), await upscale(schedPath, 3, true)]) {
  const { data: sched } = await worker.recognize(variant);
  for (const w of sched.text.split(/\s+/).map(clean).filter(Boolean)) got.add(w);
}
const hit = truthWords.filter((w) => got.has(w)).length;
console.log(`schedule: ${hit}/${truthWords.length} words recovered (3x upscale, no whitelist)`);
console.log("missed:", truthWords.filter((w) => !got.has(w)).join(", ") || "none");

await worker.terminate();

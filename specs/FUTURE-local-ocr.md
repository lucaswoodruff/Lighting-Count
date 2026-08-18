# Future pursuit: local (in-browser) OCR for scanned / outlined-text drawings

Status: **Phases 2–4 complete — OCR features shipped** (2026-08-18).

- **Tag suggestions (Phase 2):** boxing a Match Symbol example OCRs a padded
  crop around it (symbol whited out — it OCRs as letters otherwise) and offers
  the read tag as a click-to-use suggestion in the side panel. Verified e2e on
  a ~300 DPI synthetic scan: "EM1" at 90% confidence.
- **Scanned schedules (Phase 3):** a `schedule-ocr` drag-box tool renders the
  region at high res, OCRs three preprocessing variants (incl. sparse-text
  mode — table grid lines break AUTO segmentation), maps word boxes to page
  space, and feeds each through the existing column-driven `parseSchedule`;
  the best parse is shown for user confirmation. Entry points: the
  "schedule found but unreadable" note and the no-candidate-tags warning.
- **Hardening (Phase 4):** `ocr.ts` loads via dynamic import (own chunk);
  contrast-stretch normalization mirrors the spike; unit tests for word
  collection, store lifecycle (suggestion clearing, accept flow); `?e2e`
  window hooks for browser-driven testing.
- Fixed along the way: first-open blank sheet (bitmap render effect missing
  `pageDims` dep) and `renderRegion` leaking its translate to callers.

Phase 1 (2026-08-18): OCR infrastructure in place.

- `src/core/ocr.ts`: `recognizeTagCrop()` (Phase 0 sweep pipeline: variants ×
  rotations × PSMs, pattern-first scoring) and `recognizeScheduleRegion()`,
  plus pure scoring helpers covered by `src/core/ocr.test.ts`. Tesseract runs
  in its own Web Worker; lazy singleton, `disposeOcr()` to release WASM memory.
- `public/tesseract/`: self-hosted worker.min.js, LSTM core WASM builds
  (plain/simd/relaxedsimd), and eng.traineddata.gz (~18 MB total). Served
  from app origin; fetched lazily on first OCR use — zero startup cost and
  no runtime network, preserving the drawings-never-leave-the-machine promise.
- Verified in a real headless browser via `public/ocr-selftest.html`
  (`vite preview`, open `/ocr-selftest.html` → "PASS: recognized EM1
  (conf 90)"; network log showed only same-origin requests).
- Not yet wired into any UI — that's Phase 2 (auto-label Match Symbol hits)
  and Phase 3 (scanned schedule regions). Import `ocr.ts` via dynamic
  `import()` at call sites so the main bundle stays lean.

Phase 0 (2026-08-18): **GO for Tesseract.js.** Spike script,
fixture generator, and test crops live in `specs/ocr-spike/`
(`npm i tesseract.js sharp && node spike.mjs`; `TAGSET=tags300` selects the
300-DPI-equivalent set). Results:

| Fixture set | Baseline (raw crop, defaults) | Full pipeline |
|---|---|---|
| Tags @ ~300 DPI equiv (incl. 90/180° rotations) | 5/8 | **8/8** |
| Tags @ ~100 DPI equiv (9–12 px text) | 0/8 | 3/8 |
| Schedule table region (3× upscale) | — | 18/21 words |

What the spike taught us, beyond the plan's original mitigations:

- **Candidate sweep + pattern-first scoring is the key mitigation.** Run
  {raw, 2× upscale, 4× upscale+binarize} × {0/90/180/270} × {PSM auto,
  single-line} and pick the result matching the tag regex
  (`^[A-Z]{1,3}-?\d{1,3}[A-Z]?$`) with highest confidence. Picking by
  confidence alone chooses garbage; a single preprocessing recipe loses to
  baseline on clean input (harsh binarization *degrades* decent crops).
- **PSM single-line alone fails** — leader lines/arc clutter in the crop
  breaks the single-line assumption; PSM auto must stay in the sweep.
- **Resolution is the gate.** ~300 DPI-equivalent (tag text ≥ ~25 px tall)
  works; ~100 DPI does not. The UI should upsample crops from the source
  raster and warn/suppress suggestions when effective text height is tiny.
- ~24 recognitions per crop is fine for one-crop-per-match-group usage.
- Schedule misses were small numerics — acceptable since the parse path shows
  the OCR grid for user correction before `parseSchedule`.
- Fixtures are synthetic (noise + blur + clutter). Replace/augment with real
  scanned-sheet crops when a project drawing is available.

Original plan below. This is the one capability gap
left after R1–R8: drawings whose text is outlined vectors or a raster scan have
no text layer, so tag detection (`src/core/detect.ts`) and schedule parsing
(`src/core/schedule.ts`) find nothing, and Match Symbol finds occurrences but
can't name them.

## Constraint

The app's core promise is client-only — drawings never leave the machine. Any
OCR must run entirely in the browser, with model/language assets self-hosted in
the bundle (no CDN fetch at runtime), so the no-network guarantee holds.

## Options evaluated

### 1. Tesseract.js (WASM) — recommended starting point
- Pure WASM Tesseract; runs in a Web Worker; fully offline once the ~15 MB
  core + language assets are bundled/self-hosted.
- Weakness: poor on tiny, sparse, rotated text — exactly what fixture tags on
  electrical sheets look like. Mitigations that make it viable:
  - OCR small **crops**, not whole sheets: upscale each crop 3–4× before
    recognition.
  - Whitelist the tag alphabet (`A-Z0-9-`) via `tessedit_char_whitelist`.
  - Try 0/90/180/270 rotations per crop (tags and titleblocks are often
    rotated; see R6/R7 findings).

### 2. ONNX Runtime Web + modern OCR model (PaddleOCR / TrOCR export)
- Meaningfully better accuracy than Tesseract on odd fonts and rotated text;
  runs on WebGPU with WASM fallback.
- Cost: ~10–50 MB of weights and owning the full detection→recognition
  pre/post-processing pipeline. The "do it right" option if OCR becomes core.

### 3. Browser-native Shape Detection API (`TextDetector`)
- Zero dependencies, but Chrome-only and behind flags. Not viable for a tool
  people actually use. Rejected.

### 4. Scribe.js / ocrs (Rust→WASM)
- Lighter, newer WASM engines; less battle-tested, weaker on non-standard
  fonts. Watch, don't adopt yet.

## Recommended shape (when pursued)

Apply OCR **surgically**, hybrid with the existing pipelines — never whole-page:

1. **Auto-label Match Symbol hits**: after a match run, OCR each hit's small
   upscaled crop to propose the tag name instead of asking the user to type it.
2. **Scanned fixture schedules**: OCR the user-selected schedule table region
   (text there is larger and grid-aligned — the easy case), then feed the
   result through the existing `parseSchedule` path.
3. Keep the candidates-not-answers trust model: OCR output is a *suggestion*
   the user confirms, same as text detection today.

Compute stays bounded (crops only), the worker pattern from R7 already exists
to host it, and the no-upload promise is preserved.

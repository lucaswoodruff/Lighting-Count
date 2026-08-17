# Future pursuit: local (in-browser) OCR for scanned / outlined-text drawings

Status: **not implemented** — plan document only. This is the one capability gap
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

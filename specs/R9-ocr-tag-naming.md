# R9: Local OCR — read the tag name next to a boxed symbol

Implements the first tranche of `FUTURE-local-ocr.md`: after boxing example
symbol(s) with Match Symbol, a **Read name (OCR)** button proposes the fixture
type name so the user doesn't have to type it. The suggestion lands in the
name input, editable, and nothing runs until the user clicks Find matches —
the candidates-not-answers trust model holds.

## Constraint honored

All OCR assets are self-hosted in `public/ocr/` (Tesseract worker, LSTM WASM
cores, `eng` fast traineddata ≈ 6 MB total) and lazy-loaded on first use from
this app's own origin. No CDN, no network for drawing content — the client-only
promise is unchanged.

## Pipeline (src/core/ocr.ts)

1. `expandBox` grows each example box outward (labels sit *next to* symbols).
2. `renderRegionGray` (pdfService) rasterizes the neighborhood at 8× straight
   from the PDF vectors — crisp glyphs, unlike upscaling the page raster.
3. `binarize` keeps only near-black ink: gray gridlines that run through
   labels vanish (this alone fixed F1E being read as "FTE").
4. Tesseract runs with PSM sparse and a whitelist that **omits I and O** —
   fixture-tag conventions avoid them, and their absence forces the correct
   digit ("F1", not "FI").
5. `pickTagNear` chooses per crop: canonical letters+digits forms (F1E)
   outrank pure-letter reads (NL); nearer to the boxed symbol beats farther.
6. `voteTag` majority-votes across multiple example boxes.

## Validated against 420 Woodruff EL-1.0 (outlined-text CAD export)

| boxed symbol | OCR proposed | matches found |
| ------------ | ------------ | ------------- |
| F1 (hollow)  | "F1" ✓       | 52            |
| F1E (filled) | "F1E" ✓      | 7             |

## Not yet done (still future)

- OCR of scanned fixture-schedule tables (`FUTURE-local-ocr.md` item 2).
- Rotated labels: crops are OCR'd upright only.

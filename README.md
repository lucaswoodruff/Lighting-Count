# Lighting Takeoff

A client-only web app for counting lighting fixtures on vector-PDF electrical
drawings. Open a drawing set, set the scale, draw a perimeter around any area,
and the app reports the square footage of that area plus a count of each
fixture type inside it — with an Excel export when you're done.

All processing happens in the browser. Drawings never leave your machine.

## How it works

1. **Open PDF** — pick the lighting plan sheet from the page list.
2. **Set scale** — either enter the plotted scale (e.g. 1/8" = 1'-0") or draw a
   calibration line over a known dimension and type its real length. If both
   are set, calibration wins.
3. **Review detected fixture types** — the app scans the sheet's text for
   fixture type tags (A, B2, EM, …) and lists candidates with counts. Check the
   ones that are real fixture types; each becomes a set of colored markers on
   the plan.

   If the drawing's text isn't real text (outlined CAD text or a scan), use
   **Match Symbol** instead: drag a snug box around one example fixture symbol,
   name the type, and the app finds every identical symbol on the sheet by
   image correlation. Rotated copies are not matched — run it once per
   orientation if needed.
4. **Draw areas** — click vertices, double-click (or Enter) to close, or use
   the Rectangle tool to drag rectangular areas. Multiple named areas per
   sheet are supported.
5. **Correct** — erase false-positive markers, add markers the detection
   missed. Counts update live.
6. **Export** — download an .xlsx with one row per area: name, square footage,
   and counts per fixture type.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests (geometry, scale, detection, export shaping)
npm run build    # typecheck + production build to dist/
```

Built with React + TypeScript + Vite, pdf.js for PDF rendering and text
extraction, Konva for the annotation layer, and SheetJS for the Excel export.

## Deployment

`npm run build` emits a fully static site in `dist/` (relative asset paths).
Host it on any static host — Azure Static Web Apps, GitHub Pages, or an
internal file share behind a web server.

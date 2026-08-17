# R8 — cache cap, Safari render cap, exposed match threshold

## Problems
1. `grayCache` in pdfService never evicts (~43 MB Float32Array per sheet at
   MAX_MATCH_DIM 4096); a session touching many sheets accumulates unbounded.
2. `MAX_RENDER_PIXELS` = 32M exceeds Safari's ~16.7M canvas-area ceiling, so
   the cap fails to do its one job (prevent blank renders) on Safari/iOS.
3. Match threshold hardcoded at 0.8; users need it lower for lossy scans and
   higher for noisy sheets.

## Decisions
- LRU of 3 pages per document for the gray cache (Map insertion order).
- MAX_RENDER_PIXELS → 16,000,000 (under Safari's limit, ~4000×4000; large
  sheets CSS-upscale a touch sooner on huge zooms — acceptable).
- "Match strictness" select (Loose 0.70 / Normal 0.80 / Strict 0.90) in
  MatchControls, threaded through MatchRequest.

## Acceptance
- Gray cache never holds more than 3 pages per document.
- Render cap ≤ 16.7M.
- Match runs use the chosen threshold; default unchanged (0.8).
- Suite green.

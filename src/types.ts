/**
 * Shared types. All coordinates are in "page space": PDF points (1/72 inch)
 * with the origin at the top-left of the page as displayed (pdf.js viewport
 * at scale 1, page rotation applied). Zoom never changes these coordinates.
 */

export interface Pt {
  x: number;
  y: number;
}

/** One text string on the page with the center of its bounding box. */
export interface PageTextItem {
  str: string;
  center: Pt;
}

export type MarkerSource = 'auto' | 'manual';

export interface Marker {
  id: string;
  tag: string;
  pt: Pt;
  source: MarkerSource;
}

export interface AreaShape {
  id: string;
  name: string;
  /** Closed polygon vertices in page space (last edge implied). */
  pts: Pt[];
}

export interface ScaleSetting {
  /** Real-world feet represented by one page-space unit (PDF point). */
  feetPerUnit: number;
  /** Human-readable description, e.g. `1/8" = 1'-0"` or `calibrated: 24.0 ft line`. */
  label: string;
  source: 'ratio' | 'calibration';
}

export interface AreaResult {
  areaId: string;
  name: string;
  squareFeet: number;
  /** tag -> fixture count inside this area */
  counts: Record<string, number>;
  totalFixtures: number;
}

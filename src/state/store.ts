import { create } from 'zustand';
import type { AreaShape, AreaResult, Marker, Pt, ScaleSetting } from '../types';
import type { TagCandidate } from '../core/detect';
import { pointInPolygon } from '../core/geometry';
import { areaSquareFeet } from '../core/scale';

export type Tool = 'pan' | 'calibrate' | 'area' | 'rect' | 'match' | 'add' | 'erase';

export interface PageState {
  scale: ScaleSetting | null;
  candidates: TagCandidate[];
  /** Tags the user has confirmed as real fixture types, in confirmation order. */
  enabledTags: string[];
  /** Auto-marker ids the user erased. */
  deletedAutoIds: string[];
  manualMarkers: Marker[];
  areas: AreaShape[];
}

export const emptyPageState: PageState = {
  scale: null,
  candidates: [],
  enabledTags: [],
  deletedAutoIds: [],
  manualMarkers: [],
  areas: [],
};

/** Pending calibration line waiting for the user to enter its real length. */
export interface PendingCalibration {
  a: Pt;
  b: Pt;
}

/** Box drawn around one example symbol, awaiting a type name. */
export interface PendingMatch {
  a: Pt;
  b: Pt;
}

export interface MatchRequest {
  tag: string;
  box: PendingMatch;
}

interface TakeoffState {
  fileName: string | null;
  numPages: number;
  pageLabels: string[];
  currentPage: number; // 1-based
  tool: Tool;
  activeTag: string | null;
  zoom: number;
  tagColors: Record<string, string>;
  pendingCalibration: PendingCalibration | null;
  pendingMatch: PendingMatch | null;
  matchRequest: MatchRequest | null;
  matchStatus: string | null;
  pages: Record<number, PageState>;

  setDocument(fileName: string, numPages: number, pageLabels: string[]): void;
  closeDocument(): void;
  setPage(n: number): void;
  setTool(t: Tool): void;
  setActiveTag(tag: string | null): void;
  setZoom(z: number): void;
  setPendingCalibration(p: PendingCalibration | null): void;
  setPendingMatch(p: PendingMatch | null): void;
  requestMatch(tag: string): void;
  clearMatchRequest(): void;
  setMatchStatus(s: string | null): void;
  setMatchedPoints(page: number, tag: string, points: Pt[]): void;
  setScale(scale: ScaleSetting): void;
  setCandidates(page: number, candidates: TagCandidate[]): void;
  toggleTag(tag: string): void;
  addCustomTag(tag: string): void;
  addManualMarker(tag: string, pt: Pt): void;
  eraseMarker(id: string): void;
  addArea(pts: Pt[]): void;
  renameArea(id: string, name: string): void;
  deleteArea(id: string): void;
}

const PALETTE = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#469990', '#9a6324',
  '#800000', '#808000', '#000075', '#fabed4', '#ffe119',
];

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}:${++idCounter}`;
}

function getPage(s: TakeoffState, n?: number): PageState {
  return s.pages[n ?? s.currentPage] ?? emptyPageState;
}

function patchPage(
  s: TakeoffState,
  patch: Partial<PageState>,
  n?: number,
): Pick<TakeoffState, 'pages'> {
  const page = n ?? s.currentPage;
  return { pages: { ...s.pages, [page]: { ...getPage(s, page), ...patch } } };
}

export const useStore = create<TakeoffState>((set) => ({
  fileName: null,
  numPages: 0,
  pageLabels: [],
  currentPage: 1,
  tool: 'pan',
  activeTag: null,
  zoom: 1,
  tagColors: {},
  pendingCalibration: null,
  pendingMatch: null,
  matchRequest: null,
  matchStatus: null,
  pages: {},

  setDocument: (fileName, numPages, pageLabels) =>
    set({
      fileName,
      numPages,
      pageLabels,
      currentPage: 1,
      pages: {},
      tagColors: {},
      zoom: 1,
      tool: 'pan',
      activeTag: null,
      pendingCalibration: null,
      pendingMatch: null,
      matchRequest: null,
      matchStatus: null,
    }),

  closeDocument: () =>
    set({ fileName: null, numPages: 0, pageLabels: [], pages: {}, pendingCalibration: null }),

  setPage: (n) =>
    set({ currentPage: n, pendingCalibration: null, pendingMatch: null, matchStatus: null }),
  setTool: (tool) => set({ tool, pendingCalibration: null, pendingMatch: null }),
  setActiveTag: (activeTag) => set({ activeTag }),
  setZoom: (zoom) => set({ zoom: Math.min(8, Math.max(0.2, zoom)) }),
  setPendingCalibration: (pendingCalibration) => set({ pendingCalibration }),
  setPendingMatch: (pendingMatch) => set({ pendingMatch }),

  requestMatch: (tag) =>
    set((s) =>
      s.pendingMatch
        ? { matchRequest: { tag, box: s.pendingMatch }, pendingMatch: null }
        : {},
    ),
  clearMatchRequest: () => set({ matchRequest: null }),
  setMatchStatus: (matchStatus) => set({ matchStatus }),

  /**
   * Install symbol-match results as the detection points for `tag` on the
   * page: replaces any prior points for that tag, clears that tag's
   * erasures, enables it, and gives it a color.
   */
  setMatchedPoints: (pageNum, tag, points) =>
    set((s) => {
      const page = s.pages[pageNum] ?? emptyPageState;
      const candidates = [
        ...page.candidates.filter((c) => c.tag !== tag),
        { tag, points },
      ].sort((a, b) => b.points.length - a.points.length || a.tag.localeCompare(b.tag));
      const tagColors = { ...s.tagColors };
      if (!(tag in tagColors)) {
        tagColors[tag] = PALETTE[Object.keys(tagColors).length % PALETTE.length];
      }
      return {
        ...patchPage(
          s,
          {
            candidates,
            enabledTags: page.enabledTags.includes(tag)
              ? page.enabledTags
              : [...page.enabledTags, tag],
            deletedAutoIds: page.deletedAutoIds.filter(
              (id) => !id.startsWith(`auto:${tag}:`),
            ),
          },
          pageNum,
        ),
        tagColors,
      };
    }),

  setScale: (scale) => set((s) => patchPage(s, { scale })),

  setCandidates: (page, candidates) => set((s) => patchPage(s, { candidates }, page)),

  toggleTag: (tag) =>
    set((s) => {
      const page = getPage(s);
      const enabled = page.enabledTags.includes(tag)
        ? page.enabledTags.filter((t) => t !== tag)
        : [...page.enabledTags, tag];
      const tagColors = { ...s.tagColors };
      if (!(tag in tagColors)) {
        tagColors[tag] = PALETTE[Object.keys(tagColors).length % PALETTE.length];
      }
      return { ...patchPage(s, { enabledTags: enabled }), tagColors };
    }),

  addCustomTag: (tag) =>
    set((s) => {
      const page = getPage(s);
      if (page.candidates.some((c) => c.tag === tag)) {
        return page.enabledTags.includes(tag)
          ? {}
          : { ...patchPage(s, { enabledTags: [...page.enabledTags, tag] }) };
      }
      const tagColors = { ...s.tagColors };
      if (!(tag in tagColors)) {
        tagColors[tag] = PALETTE[Object.keys(tagColors).length % PALETTE.length];
      }
      return {
        ...patchPage(s, {
          candidates: [...page.candidates, { tag, points: [] }],
          enabledTags: [...page.enabledTags, tag],
        }),
        tagColors,
        activeTag: tag,
      };
    }),

  addManualMarker: (tag, pt) =>
    set((s) => {
      const page = getPage(s);
      const marker: Marker = { id: nextId('manual'), tag, pt, source: 'manual' };
      return patchPage(s, { manualMarkers: [...page.manualMarkers, marker] });
    }),

  eraseMarker: (id) =>
    set((s) => {
      const page = getPage(s);
      if (id.startsWith('auto:')) {
        return patchPage(s, { deletedAutoIds: [...page.deletedAutoIds, id] });
      }
      return patchPage(s, { manualMarkers: page.manualMarkers.filter((m) => m.id !== id) });
    }),

  addArea: (pts) =>
    set((s) => {
      const page = getPage(s);
      const area: AreaShape = {
        id: nextId('area'),
        name: `Area ${page.areas.length + 1}`,
        pts,
      };
      return patchPage(s, { areas: [...page.areas, area] });
    }),

  renameArea: (id, name) =>
    set((s) => {
      const page = getPage(s);
      return patchPage(s, {
        areas: page.areas.map((a) => (a.id === id ? { ...a, name } : a)),
      });
    }),

  deleteArea: (id) =>
    set((s) => {
      const page = getPage(s);
      return patchPage(s, { areas: page.areas.filter((a) => a.id !== id) });
    }),
}));

export function usePageState(): PageState {
  return useStore((s) => s.pages[s.currentPage] ?? emptyPageState);
}

/**
 * Effective markers on a page: every occurrence of each confirmed tag from
 * detection (minus the ones the user erased) plus manual additions.
 * Auto ids are stable (`auto:<tag>:<index>`) so erasures survive re-renders.
 */
export function effectiveMarkers(page: PageState): Marker[] {
  const markers: Marker[] = [];
  const deleted = new Set(page.deletedAutoIds);
  for (const cand of page.candidates) {
    if (!page.enabledTags.includes(cand.tag)) continue;
    cand.points.forEach((pt, i) => {
      const id = `auto:${cand.tag}:${i}`;
      if (!deleted.has(id)) markers.push({ id, tag: cand.tag, pt, source: 'auto' });
    });
  }
  for (const m of page.manualMarkers) {
    if (page.enabledTags.includes(m.tag)) markers.push(m);
  }
  return markers;
}

/** Per-area square footage and fixture counts. Requires a scale for sf. */
export function computeResults(page: PageState): AreaResult[] {
  const markers = effectiveMarkers(page);
  return page.areas.map((area) => {
    const counts: Record<string, number> = {};
    for (const tag of page.enabledTags) counts[tag] = 0;
    let total = 0;
    for (const m of markers) {
      if (pointInPolygon(m.pt, area.pts)) {
        counts[m.tag] = (counts[m.tag] ?? 0) + 1;
        total++;
      }
    }
    return {
      areaId: area.id,
      name: area.name,
      squareFeet: page.scale ? areaSquareFeet(area.pts, page.scale) : NaN,
      counts,
      totalFixtures: total,
    };
  });
}

import {
  matchTemplate,
  mergeMatchSets,
  rotate90,
  type GrayImage,
  type Match,
  type TemplateMatchSet,
} from '../core/match';

/**
 * Off-main-thread symbol matching: each example template is correlated at
 * 0/90/180/270 degrees and the hits merged, so the UI stays responsive and
 * rotated CAD placements are found in one run.
 */

export interface MatchWorkRequest {
  image: GrayImage;
  templates: GrayImage[];
  threshold: number;
}

export type MatchWorkResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; matches: Match[]; minTplDim: number }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<MatchWorkRequest>) => {
  const { image, templates, threshold } = e.data;
  try {
    const sets: TemplateMatchSet[] = [];
    const total = templates.length * 4;
    let done = 0;
    for (const base of templates) {
      let tpl = base;
      for (let rot = 0; rot < 4; rot++) {
        sets.push({
          matches: matchTemplate(image, tpl, threshold),
          tplW: tpl.width,
          tplH: tpl.height,
        });
        done++;
        (self as unknown as Worker).postMessage({
          type: 'progress',
          done,
          total,
        } satisfies MatchWorkResponse);
        tpl = rotate90(tpl);
      }
    }
    const matches = mergeMatchSets(sets);
    const minTplDim = Math.min(...templates.map((t) => Math.min(t.width, t.height)));
    (self as unknown as Worker).postMessage({
      type: 'done',
      matches,
      minTplDim,
    } satisfies MatchWorkResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies MatchWorkResponse);
  }
};

import type { ScoredResult } from './recallScoring';

export interface RecallDisplayItem extends ScoredResult {
  score_display: number;
  boot: boolean;
}

export interface RecallSuppressed {
  boot: number;
  score: number;
}

export function buildRecallDisplay({
  ranked,
  bootUris,
  scorePrecision,
  minScore,
  candidateCount,
  maxDisplayItems,
  minDisplayScore,
}: {
  ranked: ScoredResult[];
  bootUris: Set<string>;
  scorePrecision: number;
  minScore: number;
  candidateCount: number;
  maxDisplayItems: number;
  minDisplayScore: number;
}): {
  ranked: RecallDisplayItem[];
  candidates: RecallDisplayItem[];
  items: RecallDisplayItem[];
  suppressed: RecallSuppressed;
} {
  const decorated = ranked
    .flatMap((item) => {
      const decoratedItem = {
      ...item,
      score_display: Number(item.score.toFixed(scorePrecision)),
      boot: bootUris.has(item.uri),
      };
      return decoratedItem.score >= minScore ? [decoratedItem] : [];
    });

  const candidates = decorated.slice(0, candidateCount);
  const items: RecallDisplayItem[] = [];
  const suppressed: RecallSuppressed = { boot: 0, score: 0 };

  for (const item of candidates) {
    if (item.boot) {
      suppressed.boot += 1;
      continue;
    }
    if (item.score < minDisplayScore) {
      suppressed.score += 1;
      continue;
    }
    items.push(item);
    if (items.length >= maxDisplayItems) break;
  }

  return { ranked: decorated, candidates, items, suppressed };
}

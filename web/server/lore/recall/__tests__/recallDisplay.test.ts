import { describe, expect, it } from 'vitest';

import { buildRecallDisplay } from '../recallDisplay';

const baseCandidate = {
  uri: 'core://read-before',
  score: 0.91,
  matched_on: ['dense'],
  cues: ['cue'],
  priority: 2,
  exact_score: 0,
  glossary_semantic_score: 0,
  dense_score: 0.91,
  lexical_score: 0,
  score_breakdown: {},
};

describe('buildRecallDisplay', () => {
  it('does not suppress or annotate candidates using session read state', () => {
    const result = buildRecallDisplay({
      ranked: [baseCandidate],
      bootUris: new Set(),
      scorePrecision: 2,
      minScore: 0,
      candidateCount: 1,
      maxDisplayItems: 1,
      minDisplayScore: 0.1,
    } as any);

    expect(result.items.map((item) => item.uri)).toEqual(['core://read-before']);
    expect(result.items[0]).not.toHaveProperty('read');
    expect(result.suppressed).toEqual({ boot: 0, score: 0 });
  });
});

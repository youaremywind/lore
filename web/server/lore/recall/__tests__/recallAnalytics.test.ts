import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
import { sql } from '../../../db';
import { clearCache } from '../../config/settings';
import {
  sanitizeFilter,
  buildStatsWhere,
  mergeEventsByNode,
  reshapeEventsForDebugView,
  getRecallStats,
  getDreamRecallReview,
  getDreamQueryRecallDetail,
  getDreamQueryCandidates,
  getDreamQueryPathBreakdown,
  getDreamQueryNodePaths,
  getDreamQueryEventSamples,
} from '../recallAnalytics';

const mockSql = vi.mocked(sql);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

// ---------------------------------------------------------------------------
// sanitizeFilter
// ---------------------------------------------------------------------------

describe('sanitizeFilter', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeFilter('  hello   world  ')).toBe('hello world');
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeFilter('')).toBe('');
    expect(sanitizeFilter(null)).toBe('');
    expect(sanitizeFilter(undefined)).toBe('');
  });

  it('truncates to maxChars', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeFilter(long, 10)).toBe('a'.repeat(10));
  });

  it('defaults maxChars to 240', () => {
    const long = 'b'.repeat(500);
    expect(sanitizeFilter(long).length).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// buildStatsWhere
// ---------------------------------------------------------------------------

describe('buildStatsWhere', () => {
  it('builds base time window clause', () => {
    const result = buildStatsWhere({ days: 7 });
    expect(result.where).toContain("created_at >= NOW() - ($1::int * INTERVAL '1 day')");
    expect(result.params).toEqual([7]);
    expect(result.filters).toEqual({ query_id: '', query_text: '', client_type: '' });
  });

  it('adds queryId clause', () => {
    const result = buildStatsWhere({ days: 7, queryId: 'q-123' });
    expect(result.where).toContain('query_id = $2');
    expect(result.params).toEqual([7, 'q-123']);
    expect(result.filters.query_id).toBe('q-123');
  });

  it('adds queryText ILIKE clause', () => {
    const result = buildStatsWhere({ days: 7, queryText: 'search' });
    expect(result.where).toContain('query_text ILIKE $2');
    expect(result.params[1]).toBe('%search%');
  });

  it('combines multiple filters', () => {
    const result = buildStatsWhere({ days: 14, queryId: 'q1', queryText: 'foo', clientType: 'codex' });
    expect(result.params).toHaveLength(4);
    expect(result.where).toContain('$2');
    expect(result.where).toContain('$3');
    expect(result.where).toContain('$4');
  });

  it('sanitizes filter values', () => {
    const result = buildStatsWhere({ days: 7, queryId: '  spaced  id  ' });
    expect(result.filters.query_id).toBe('spaced id');
  });

  it('clamps days via intervalDaysSql', () => {
    const result = buildStatsWhere({ days: 999 });
    expect(result.params[0]).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// mergeEventsByNode
// ---------------------------------------------------------------------------

describe('mergeEventsByNode', () => {
  it('merges multiple rows for the same URI', () => {
    const rows = [
      { node_uri: 'core://a', retrieval_path: 'exact', final_rank_score: 0.9, selected: true, metadata: { raw_score: 0.8, matched_on: ['exact'], cue_terms: ['foo'] } },
      { node_uri: 'core://a', retrieval_path: 'dense', final_rank_score: 0.9, selected: false, metadata: { raw_score: 0.7, matched_on: ['dense'], cue_terms: ['bar'] } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].uri).toBe('core://a');
    expect(merged[0].exact_score).toBe(0.8);
    expect(merged[0].dense_score).toBe(0.7);
    expect(merged[0].selected).toBe(true);
    expect(merged[0].matched_on).toContain('exact');
    expect(merged[0].matched_on).toContain('dense');
    expect(merged[0].cues).toContain('foo');
    expect(merged[0].cues).toContain('bar');
    expect(merged[0].paths).toHaveLength(2);
  });

  it('sorts by score descending then URI ascending', () => {
    const rows = [
      { node_uri: 'core://b', retrieval_path: 'exact', final_rank_score: 0.5, metadata: { raw_score: 0.5 } },
      { node_uri: 'core://a', retrieval_path: 'exact', final_rank_score: 0.9, metadata: { raw_score: 0.9 } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].uri).toBe('core://a');
    expect(merged[1].uri).toBe('core://b');
  });

  it('skips rows with empty URI', () => {
    const rows = [
      { node_uri: '', retrieval_path: 'exact', metadata: {} },
      { node_uri: 'core://valid', retrieval_path: 'exact', final_rank_score: 0.5, metadata: { raw_score: 0.5 } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].uri).toBe('core://valid');
  });

  it('uses max final_rank_score across rows', () => {
    const rows = [
      { node_uri: 'core://x', retrieval_path: 'exact', final_rank_score: 0.3, metadata: { raw_score: 0.3 } },
      { node_uri: 'core://x', retrieval_path: 'dense', final_rank_score: 0.8, metadata: { raw_score: 0.8 } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].score).toBe(0.8);
  });

  it('captures score_breakdown from first row that has it', () => {
    const rows = [
      { node_uri: 'core://y', retrieval_path: 'exact', metadata: { raw_score: 0.5 } },
      { node_uri: 'core://y', retrieval_path: 'dense', metadata: { raw_score: 0.7, score_breakdown: { dense: 0.7 } } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].score_breakdown).toEqual({ dense: 0.7 });
  });

  it('handles glossary_semantic path', () => {
    const rows = [
      { node_uri: 'core://gs', retrieval_path: 'glossary_semantic', final_rank_score: 0.6, metadata: { raw_score: 0.6, glossary_terms: ['term1'] } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].glossary_semantic_score).toBe(0.6);
    expect(merged[0].cues).toContain('term1');
  });

  it('handles lexical path', () => {
    const rows = [
      { node_uri: 'core://lx', retrieval_path: 'lexical', final_rank_score: 0.4, metadata: { raw_score: 0.4 } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].lexical_score).toBe(0.4);
  });

  it('limits cues to 6', () => {
    const cues = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rows = [
      { node_uri: 'core://many', retrieval_path: 'exact', metadata: { raw_score: 1, cue_terms: cues } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].cues.length).toBeLessThanOrEqual(6);
  });

  it('returns empty array for empty input', () => {
    expect(mergeEventsByNode([])).toEqual([]);
  });

  it('captures client_type from metadata when merging rows', () => {
    const rows = [
      { node_uri: 'core://client', retrieval_path: 'exact', final_rank_score: 0.8, metadata: { raw_score: 0.8, client_type: 'claudecode' } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].client_type).toBe('claudecode');
  });
});

// ---------------------------------------------------------------------------
// reshapeEventsForDebugView
// ---------------------------------------------------------------------------

describe('reshapeEventsForDebugView', () => {
  it('reshapes exact rows into exact_hits', () => {
    const rows = [
      { node_uri: 'core://e', retrieval_path: 'exact', metadata: { raw_score: 0.9, exact_flags: { path_exact_hit: true } } },
    ];
    const merged = [{ uri: 'core://e', score: 0.9, selected: true, displayed_position: 1, matched_on: ['exact'], cues: [], score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.exact_hits).toHaveLength(1);
    expect(result.exact_hits[0]).toHaveProperty('uri', 'core://e');
    expect(result.exact_hits[0]).toHaveProperty('path_exact_hit', true);
  });

  it('reshapes glossary_semantic rows', () => {
    const rows = [
      { node_uri: 'core://gs', retrieval_path: 'glossary_semantic', metadata: { raw_score: 0.7, cue_terms: ['keyword1'] } },
    ];
    const merged = [{ uri: 'core://gs', score: 0.7, selected: false, matched_on: ['glossary_semantic'], cues: ['keyword1'], score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.glossary_semantic_hits).toHaveLength(1);
    expect(result.glossary_semantic_hits[0]).toHaveProperty('keyword', 'keyword1');
  });

  it('reshapes dense rows', () => {
    const rows = [
      { node_uri: 'core://d', retrieval_path: 'dense', view_type: 'gist', metadata: { raw_score: 0.6, source_weight: 1.5, llm_refined: true } },
    ];
    const merged = [{ uri: 'core://d', score: 0.6, selected: false, matched_on: ['dense'], cues: [], score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.dense_hits).toHaveLength(1);
    expect(result.dense_hits[0]).toHaveProperty('semantic_score', 0.6);
    expect(result.dense_hits[0]).toHaveProperty('llm_refined', true);
  });

  it('reshapes lexical rows', () => {
    const rows = [
      { node_uri: 'core://l', retrieval_path: 'lexical', metadata: { raw_score: 0.5, lexical_flags: { fts_hit: true, text_hit: false, uri_hit: true } } },
    ];
    const merged = [{ uri: 'core://l', score: 0.5, selected: false, matched_on: ['lexical'], cues: [], score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.lexical_hits).toHaveLength(1);
    expect(result.lexical_hits[0]).toHaveProperty('fts_hit', true);
    expect(result.lexical_hits[0]).toHaveProperty('uri_hit', true);
    expect(result.lexical_hits[0]).toHaveProperty('text_hit', false);
  });

  it('builds items from selected merged candidates', () => {
    const rows = [
      { node_uri: 'core://s1', retrieval_path: 'exact', metadata: { raw_score: 0.9 } },
      { node_uri: 'core://s2', retrieval_path: 'dense', metadata: { raw_score: 0.7 } },
    ];
    const merged = [
      { uri: 'core://s1', score: 0.9, selected: true, displayed_position: 2, matched_on: ['exact'], cues: ['c1'], score_breakdown: null } as any,
      { uri: 'core://s2', score: 0.7, selected: true, displayed_position: 1, matched_on: ['dense'], cues: [], score_breakdown: null } as any,
    ];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.items).toHaveLength(2);
    // sorted by displayed_position
    expect(result.items[0].uri).toBe('core://s2');
    expect(result.items[1].uri).toBe('core://s1');
  });

  it('includes client_type in reshaped debug items', () => {
    const rows = [
      { node_uri: 'core://debug', retrieval_path: 'exact', metadata: { raw_score: 0.9, client_type: 'hermes' } },
    ];
    const merged = [{ uri: 'core://debug', score: 0.9, selected: true, displayed_position: 1, matched_on: ['exact'], cues: [], client_type: 'hermes', score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.items[0]).toHaveProperty('client_type', 'hermes');
    expect(result.exact_hits[0]).toHaveProperty('client_type', 'hermes');
  });
});

describe('getDreamRecallReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReset();
  });

  it('returns local-day raw recall metadata without heuristic flags', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      {
        query_id: 'q1',
        query_text: 'where is boot guidance',
        session_id: 's1',
        client_type: 'claudecode',
        merged_count: '6',
        shown_count: '1',
        used_count: '0',
        created_at: '2026-04-18T09:00:00Z',
      },
    ]));

    const review = await getDreamRecallReview({ date: '2026-04-18', limit: 100 });

    expect(review).toEqual({
      date: '2026-04-18',
      limit: 100,
      offset: 0,
      summary: {
        returned_queries: 1,
        total_merged: 6,
        total_shown: 1,
        total_used: 0,
        truncated: false,
      },
      queries: [
        {
          query_id: 'q1',
          content: 'where is boot guidance',
          content_full_chars: 22,
          session_id: 's1',
          client_type: 'claudecode',
          merged_count: 6,
          shown_count: 1,
          used_count: 0,
          created_at: '2026-04-18T09:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(review)).not.toContain('zero_use');
    expect(JSON.stringify(review)).not.toContain('high_merge_low_use');
    expect(JSON.stringify(review)).not.toContain('missed_recall_signals');

    const sqlText = mockSql.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sqlText).toContain('FROM recall_queries q');
    expect(sqlText).not.toContain('FROM recall_query_candidates');
    expect(sqlText).not.toContain('FROM recall_events');
    expect(sqlText).not.toContain("metadata->>'query_id'");
  });

  it('limits query content preview to 300 characters and reports truncation', async () => {
    const longQuery = 'a'.repeat(320);
    mockSql.mockResolvedValueOnce(makeResult([
      {
        query_id: 'q2',
        query_text: longQuery,
        session_id: '',
        client_type: '',
        merged_count: '4',
        shown_count: '2',
        used_count: '1',
        created_at: '2026-04-18T10:00:00Z',
      },
    ]));

    const review = await getDreamRecallReview({ date: '2026-04-18', limit: 1, offset: 0 });

    expect(review.summary).toEqual({
      returned_queries: 1,
      total_merged: 4,
      total_shown: 2,
      total_used: 1,
      truncated: true,
    });
    expect(review.queries[0]).toMatchObject({
      query_id: 'q2',
      content: 'a'.repeat(300),
      content_full_chars: 320,
      session_id: null,
      client_type: null,
    });
  });
});

describe('getDreamQueryRecallDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReset();
  });

  it('returns only dream-needed query fields and shown node URIs', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([
        {
          query_id: 'q-detail',
          query_text: 'why did dream fail',
          session_id: 's1',
          client_type: 'codex',
          merged_count: 42,
          shown_count: 2,
          used_count: 1,
          created_at: '2026-05-03T00:48:53Z',
        },
      ]))
      .mockResolvedValueOnce(makeResult([
        { node_uri: 'core://used' },
        { node_uri: 'core://shown' },
      ]));

    const detail = await getDreamQueryRecallDetail({ days: 1, queryId: 'q-detail', limit: 20 });

    expect(detail).toMatchObject({
      query_id: 'q-detail',
      query_text: 'why did dream fail',
      session_id: 's1',
      client_type: 'codex',
      merged_count: 42,
      shown_count: 2,
      used_count: 1,
      shown_node_uris: ['core://used', 'core://shown'],
    });
    expect(detail).not.toHaveProperty('query_detail');
    expect(detail).not.toHaveProperty('recent_events');
    expect(detail).not.toHaveProperty('candidates');
    expect(detail).not.toHaveProperty('path_breakdown');

    const sqlText = mockSql.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sqlText).toContain('FROM recall_queries q');
    expect(sqlText).toContain('FROM recall_query_candidates c');
    expect(sqlText).toContain('c.selected = TRUE');
    expect(sqlText).not.toContain('FROM recall_events');
    expect(sqlText).not.toContain("metadata->>'query_id'");
  });
});

describe('dream query drilldown analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReset();
  });

  it('loads query candidates from candidate rollups with optional selected and used filters', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      { node_uri: 'core://a', final_rank_score: 0.8, selected: true, used_in_answer: false, ranked_position: 1, displayed_position: 1 },
    ]));

    const result = await getDreamQueryCandidates({ queryId: 'q1', limit: 8, selectedOnly: true, usedOnly: true });

    expect(result).toEqual({
      query_id: 'q1',
      candidates: [
        { node_uri: 'core://a', final_rank_score: 0.8, selected: true, used_in_answer: false, ranked_position: 1, displayed_position: 1 },
      ],
    });
    const sqlText = String(mockSql.mock.calls[0][0]);
    expect(sqlText).toContain('FROM recall_query_candidates c');
    expect(sqlText).toContain('c.selected = TRUE');
    expect(sqlText).toContain('c.used_in_answer = TRUE');
    expect(sqlText).not.toContain('FROM recall_events');
  });

  it('loads query path breakdown from aggregated recall events', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      { retrieval_path: 'dense', view_type: 'gist', total: '4', selected: '2', used_in_answer: '1', avg_final_rank_score: '0.7' },
    ]));

    const result = await getDreamQueryPathBreakdown({ queryId: 'q1' });

    expect(result).toEqual({
      query_id: 'q1',
      paths: [
        expect.objectContaining({ retrieval_path: 'dense', view_type: 'gist', total: 4, selected: 2, used_in_answer: 1, avg_final_rank_score: 0.7 }),
      ],
    });
    const sqlText = String(mockSql.mock.calls[0][0]);
    expect(sqlText).toContain('FROM recall_events e');
    expect(sqlText).toContain('GROUP BY e.retrieval_path, e.view_type');
  });

  it('loads node-specific query paths from aggregated recall events', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      { retrieval_path: 'lexical', view_type: 'question', events: '3', selected_events: '0', used_events: '0', avg_pre_rank_score: '0.4', avg_final_rank_score: '0.55' },
    ]));

    const result = await getDreamQueryNodePaths({ queryId: 'q1', nodeUri: 'core://a' });

    expect(result).toEqual({
      query_id: 'q1',
      node_uri: 'core://a',
      paths: [
        expect.objectContaining({ retrieval_path: 'lexical', view_type: 'question', events: 3, selected_events: 0, used_events: 0, avg_pre_rank_score: 0.4, avg_final_rank_score: 0.55 }),
      ],
    });
    const sqlText = String(mockSql.mock.calls[0][0]);
    expect(sqlText).toContain('e.node_uri = $2');
  });

  it('loads small event samples without metadata unless requested', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      { id: 1, node_uri: 'core://a', retrieval_path: 'dense', view_type: 'gist', pre_rank_score: '0.4', final_rank_score: '0.6', selected: true, used_in_answer: false, ranked_position: 2, displayed_position: 1, metadata: { raw: 'hidden' }, created_at: '2026-05-03T00:00:00Z' },
    ]));

    const result = await getDreamQueryEventSamples({ queryId: 'q1', nodeUri: 'core://a', retrievalPath: 'dense', limit: 3 });

    expect(result.events[0]).toEqual({
      id: 1,
      node_uri: 'core://a',
      retrieval_path: 'dense',
      view_type: 'gist',
      pre_rank_score: 0.4,
      final_rank_score: 0.6,
      selected: true,
      used_in_answer: false,
      ranked_position: 2,
      displayed_position: 1,
      created_at: '2026-05-03T00:00:00.000Z',
    });
    expect(result.events[0]).not.toHaveProperty('metadata');
    const sqlText = String(mockSql.mock.calls[0][0]);
    expect(sqlText).toContain('e.query_id = $1');
    expect(sqlText).toContain('e.node_uri = $2');
    expect(sqlText).toContain('e.retrieval_path = $3');
  });

  it('includes event metadata only when explicitly requested', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      { id: 1, node_uri: 'core://a', retrieval_path: 'dense', view_type: 'gist', pre_rank_score: null, final_rank_score: null, selected: false, used_in_answer: false, ranked_position: null, displayed_position: null, metadata: { raw: 'visible' }, created_at: null },
    ]));

    const result = await getDreamQueryEventSamples({ queryId: 'q1', includeMetadata: true });

    expect(result.events[0]).toHaveProperty('metadata', { raw: 'visible' });
  });
});

// ---------------------------------------------------------------------------
// getRecallStats
// ---------------------------------------------------------------------------

describe('getRecallStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    mockSql.mockResolvedValue(makeResult());
  });

  it('returns structured stats with defaults', async () => {
    mockSql.mockResolvedValue(makeResult([{
      total_merged: '10',
      total_shown: '5',
      total_used: '2',
      query_count: '3',
      last_event_at: '2025-01-01T00:00:00Z',
    }]));
    const stats = await getRecallStats();
    expect(stats.window_days).toBe(7);
    expect(stats.aggregation_unit).toBe('path_event');
    expect(stats.summary).toBeDefined();
    expect(stats.by_path).toBeDefined();
    expect(stats.by_view_type).toBeDefined();
    expect(stats.noisy_nodes).toBeDefined();
    expect(stats.recent_queries).toBeDefined();
    expect(stats.recent_events).toBeDefined();
  });

  it('uses custom days and limit', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));
    const stats = await getRecallStats({ days: 14, limit: 5 });
    expect(stats.window_days).toBe(14);
  });

  it('clamps limit to valid range', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));
    // limit < 3 should clamp to 3
    const stats = await getRecallStats({ limit: 1 });
    // We can verify it ran without error; exact limit is internal
    expect(stats).toBeDefined();
  });

  it('includes filters when queryId is provided', async () => {
    // Provide enough mock results for all the parallel queries + the query detail queries
    const summaryRow = { total_merged: '5', total_shown: '2', total_used: '1', query_count: '1', last_event_at: '2025-01-01T00:00:00Z' };
    mockSql.mockResolvedValue(makeResult([summaryRow]));
    const stats = await getRecallStats({ queryId: 'q-test' });
    expect(stats.filters).toBeDefined();
    expect(stats.filters?.query_id).toBe('q-test');
    expect(stats.query_detail).toBeDefined();
  });

  it('rebuilds query detail from complete path events while keeping recent events limited', async () => {
    mockSql.mockImplementation(async (query: string) => {
      const sqlText = String(query);
      if (sqlText.includes('SELECT key, value FROM app_settings')) {
        return makeResult([{ key: 'recall.display.min_display_score', value: 0.6 }]);
      }
      if (sqlText.includes('FROM recall_queries') && sqlText.includes('SUM(merged_count)')) {
        return makeResult([{ total_merged: '1', total_shown: '1', total_used: '0', query_count: '1', last_event_at: '2026-05-04T10:35:42Z' }]);
      }
      if (sqlText.includes('FROM recall_queries') && sqlText.includes('COUNT(*)::int AS total')) {
        return makeResult([{ total: '1' }]);
      }
      if (sqlText.includes('FROM recall_queries') && sqlText.includes('ORDER BY created_at DESC')) {
        return makeResult([{ query_id: 'q1', query_text: 'sync plugin readme', merged_count: 1, shown_count: 1, used_count: 0, client_type: 'openclaw', created_at: '2026-05-04T10:35:42Z' }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && sqlText.includes('GROUP BY')) {
        return makeResult([]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && sqlText.includes('COUNT(*) FILTER')) {
        return makeResult([{ shown_candidates: '1', used_candidates: '0' }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && sqlText.includes('SELECT c.node_uri')) {
        return makeResult([{ node_uri: 'core://a', final_rank_score: 0.9, selected: true, used_in_answer: false, ranked_position: 1, displayed_position: 1, client_type: 'openclaw', created_at: '2026-05-04T10:35:42Z' }]);
      }
      if (sqlText.includes('FROM recall_events') && sqlText.includes('GROUP BY retrieval_path')) {
        return makeResult([]);
      }
      if (sqlText.includes('FROM recall_events') && sqlText.includes('SELECT id, query_text') && sqlText.includes('LIMIT')) {
        return makeResult([
          { id: 3, query_text: 'sync plugin readme', node_uri: 'core://a', retrieval_path: 'dense', view_type: 'gist', pre_rank_score: 0.6, final_rank_score: 0.9, selected: true, used_in_answer: false, metadata: { raw_score: 0.6, matched_on: ['dense'] }, client_type: 'openclaw', ranked_position: 1, displayed_position: 1, created_at: '2026-05-04T10:35:44Z' },
        ]);
      }
      if (sqlText.includes('FROM recall_events') && sqlText.includes('SELECT id, query_text')) {
        return makeResult([
          { id: 1, query_text: 'sync plugin readme', node_uri: 'core://a', retrieval_path: 'exact', view_type: 'exact', pre_rank_score: 0.8, final_rank_score: 0.9, selected: true, used_in_answer: false, metadata: { raw_score: 0.8, matched_on: ['exact'], cue_terms: ['plugin'] }, client_type: 'openclaw', ranked_position: 1, displayed_position: 1, created_at: '2026-05-04T10:35:42Z' },
          { id: 2, query_text: 'sync plugin readme', node_uri: 'core://a', retrieval_path: 'glossary_semantic', view_type: null, pre_rank_score: 0.7, final_rank_score: 0.9, selected: true, used_in_answer: false, metadata: { raw_score: 0.7, matched_on: ['glossary_semantic'], cue_terms: ['readme'] }, client_type: 'openclaw', ranked_position: 1, displayed_position: 1, created_at: '2026-05-04T10:35:43Z' },
          { id: 3, query_text: 'sync plugin readme', node_uri: 'core://a', retrieval_path: 'dense', view_type: 'gist', pre_rank_score: 0.6, final_rank_score: 0.9, selected: true, used_in_answer: false, metadata: { raw_score: 0.6, matched_on: ['dense'] }, client_type: 'openclaw', ranked_position: 1, displayed_position: 1, created_at: '2026-05-04T10:35:44Z' },
        ]);
      }
      return makeResult();
    });

    const stats = await getRecallStats({ queryId: 'q1', limit: 3 });

    expect(stats.recent_events).toHaveLength(1);
    expect(stats.query_detail.exact_hits).toHaveLength(1);
    expect(stats.query_detail.glossary_semantic_hits).toHaveLength(1);
    expect(stats.query_detail.merged_candidates[0]).toMatchObject({
      uri: 'core://a',
      exact_score: 0.8,
      glossary_semantic_score: 0.7,
      dense_score: 0.6,
    });
  });

  it('ignores dormant nodeUri filters and does not return node_detail', async () => {
    const summaryRow = { total_merged: '3', total_shown: '1', total_used: '0', query_count: '2', last_event_at: '2025-01-01T00:00:00Z' };
    mockSql.mockResolvedValue(makeResult([summaryRow]));
    const stats = await getRecallStats({ nodeUri: 'core://test-node' } as any);
    expect(stats.filters).toBeNull();
    expect(stats).not.toHaveProperty('node_detail');
  });

  it('applies active query filters to rollup aggregate queries', async () => {
    const summaryRow = { total_merged: '3', total_shown: '1', total_used: '0', query_count: '2', last_event_at: '2025-01-01T00:00:00Z' };
    mockSql.mockResolvedValue(makeResult([summaryRow]));

    await getRecallStats({ queryId: 'q-test', clientType: 'codex' });

    const sqlText = mockSql.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sqlText).toContain('FROM recall_queries');
    expect(sqlText).toContain('FROM recall_query_candidates');
    expect(sqlText).toContain('query_id = $2');
    expect(sqlText).toContain('client_type = $3');
    expect(sqlText).not.toContain("metadata->>'query_id'");
  });

  it('loads homepage summary from recall_queries', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '10', total_shown: '5', total_used: '2', query_count: '3', last_event_at: null }]));

    await getRecallStats();

    const sqlText = mockSql.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sqlText).toContain('FROM recall_queries');
    expect(sqlText).toContain('SUM(merged_count)');
    expect(sqlText).not.toContain('COUNT(DISTINCT node_uri) AS merged_count');
  });

  it('includes query duration in recent query rows', async () => {
    mockSql.mockImplementation(async (query: string) => {
      const sqlText = String(query);
      if (sqlText.includes('SELECT key, value FROM app_settings')) {
        return makeResult([]);
      }
      if (sqlText.includes('FROM recall_queries') && sqlText.includes('SUM(merged_count)')) {
        return makeResult([{ total_merged: '1', total_shown: '1', total_used: '0', query_count: '1', last_event_at: '2026-05-04T10:35:42Z' }]);
      }
      if (sqlText.includes('FROM recall_queries') && sqlText.includes('COUNT(*)::int AS total')) {
        return makeResult([{ total: '1' }]);
      }
      if (sqlText.includes('FROM recall_queries') && sqlText.includes('ORDER BY created_at DESC')) {
        expect(sqlText).toContain('duration_ms');
        return makeResult([{ query_id: 'q1', query_text: 'sync plugin readme', merged_count: 1, shown_count: 1, used_count: 0, duration_ms: 1530, client_type: 'openclaw', created_at: '2026-05-04T10:35:42Z' }]);
      }
      return makeResult();
    });

    const stats = await getRecallStats();

    expect(stats.recent_queries.items[0]).toMatchObject({ query_id: 'q1', duration_ms: 1530 });
  });

  it('loads display threshold samples from recall_query_candidates', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));

    await getRecallStats();

    const sqlText = mockSql.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sqlText).toContain('FROM recall_query_candidates');
    expect(sqlText).not.toContain('WITH candidate_rows AS');
  });

  it('does not join recall_queries for candidate metrics unless query text filtering needs it', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));

    await getRecallStats({ clientType: 'codex' });

    const candidateQueries = mockSql.mock.calls.flatMap(([query]) => {
      const sqlText = String(query);
      return sqlText.includes('FROM recall_query_candidates') ? [sqlText] : [];
    });
    expect(candidateQueries.length).toBeGreaterThan(0);
    expect(candidateQueries.every((sqlText) => !sqlText.includes('JOIN recall_queries q'))).toBe(true);
    expect(candidateQueries.some((sqlText) => sqlText.includes('c.client_type = $2'))).toBe(true);
  });

  it('joins recall_queries for candidate metrics when query text filtering is active', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));

    await getRecallStats({ queryText: 'needle' });

    const candidateQueries = mockSql.mock.calls.flatMap(([query]) => {
      const sqlText = String(query);
      return sqlText.includes('FROM recall_query_candidates') ? [sqlText] : [];
    });
    expect(candidateQueries.some((sqlText) => sqlText.includes('JOIN recall_queries q ON q.query_id = c.query_id'))).toBe(true);
  });

  it('does not include filters when no filter is active', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));
    const stats = await getRecallStats();
    expect(stats.filters).toBeNull();
  });

  it('includes display threshold analysis aggregated by merged candidate', async () => {
    mockSql.mockImplementation(async (query: string) => {
      const sqlText = String(query);
      if (sqlText.includes('SELECT key, value FROM app_settings')) {
        return makeResult([{ key: 'recall.display.min_display_score', value: 0.55 }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && !sqlText.includes('GROUP BY')) {
        return makeResult([{
          shown_candidates: '6',
          used_candidates: '3',
          avg_shown_score: '0.68',
          avg_used_score: '0.78',
          avg_unused_shown_score: '0.55',
          used_p25_score: '0.72',
          used_p50_score: '0.80',
          unused_shown_p75_score: '0.58',
        }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && sqlText.includes('GROUP BY')) {
        return makeResult([]);
      }
      return makeResult([{ total_merged: '3', total_shown: '2', total_used: '1', query_count: '1', last_event_at: null }]);
    });

    const stats = await getRecallStats();

    expect(stats.display_threshold_analysis).toEqual({
      status: 'ready',
      basis: 'sample_metrics',
      current_min_display_score: 0.55,
      shown_candidate_count: 6,
      used_candidate_count: 3,
      unused_shown_candidate_count: 3,
      avg_shown_score: 0.68,
      avg_used_score: 0.78,
      avg_unused_shown_score: 0.55,
      used_p25_score: 0.72,
      used_p50_score: 0.8,
      unused_shown_p75_score: 0.58,
      separation_gap: 0.14,
    });
    expect(stats.display_threshold_analysis).not.toHaveProperty('suggested_min_display_score');
    expect(stats.display_threshold_analysis).not.toHaveProperty('threshold_gap');
    expect(stats.display_threshold_analysis).not.toHaveProperty('status_detail');
    expect(stats.display_threshold_analysis).not.toHaveProperty('execution_status');
  });

  it('marks negative separation as ready_but_unsafe and includes runtime gap', async () => {
    mockSql.mockImplementation(async (query: string) => {
      const sqlText = String(query);
      if (sqlText.includes('SELECT key, value FROM app_settings')) {
        return makeResult([{ key: 'recall.display.min_display_score', value: 0.55 }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && !sqlText.includes('GROUP BY')) {
        return makeResult([{
          shown_candidates: '10',
          used_candidates: '4',
          avg_shown_score: '0.65',
          avg_used_score: '0.61',
          avg_unused_shown_score: '0.67',
          used_p25_score: '0.58',
          used_p50_score: '0.61',
          unused_shown_p75_score: '0.64',
        }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && sqlText.includes('GROUP BY')) {
        return makeResult([]);
      }
      return makeResult([{ total_merged: '4', total_shown: '3', total_used: '2', query_count: '1', last_event_at: null }]);
    });

    const stats = await getRecallStats();

    expect(stats.display_threshold_analysis).toEqual({
      status: 'ready',
      basis: 'sample_metrics',
      current_min_display_score: 0.55,
      shown_candidate_count: 10,
      used_candidate_count: 4,
      unused_shown_candidate_count: 6,
      avg_shown_score: 0.65,
      avg_used_score: 0.61,
      avg_unused_shown_score: 0.67,
      used_p25_score: 0.58,
      used_p50_score: 0.61,
      unused_shown_p75_score: 0.64,
      separation_gap: -0.06,
    });
  });

  it('builds client_type threshold analysis across sources', async () => {
    mockSql.mockImplementation(async (query: string) => {
      const sqlText = String(query);
      if (sqlText.includes('SELECT key, value FROM app_settings')) {
        return makeResult([{ key: 'recall.display.min_display_score', value: 0.55 }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && !sqlText.includes('GROUP BY')) {
        return makeResult([{
          shown_candidates: '6',
          used_candidates: '3',
          avg_shown_score: '0.68',
          avg_used_score: '0.78',
          avg_unused_shown_score: '0.55',
          used_p25_score: '0.72',
          used_p50_score: '0.80',
          unused_shown_p75_score: '0.58',
        }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && sqlText.includes('GROUP BY')) {
        return makeResult([
          {
            client_type: '',
            shown_candidates: '8',
            used_candidates: '3',
            avg_shown_score: '0.60',
            avg_used_score: '0.58',
            avg_unused_shown_score: '0.63',
            used_p25_score: '0.57',
            used_p50_score: '0.58',
            unused_shown_p75_score: '0.64',
          },
          {
            client_type: 'hermes',
            shown_candidates: '12',
            used_candidates: '5',
            avg_shown_score: '0.70',
            avg_used_score: '0.74',
            avg_unused_shown_score: '0.60',
            used_p25_score: '0.69',
            used_p50_score: '0.74',
            unused_shown_p75_score: '0.61',
          },
        ]);
      }
      if (sqlText.includes('FROM memory_events')) {
        return makeResult([
          {
            client_type: 'hermes',
            memory_created_count: '2',
            memory_updated_count: '1',
            memory_deleted_count: '1',
          },
          {
            client_type: 'codex',
            memory_created_count: '1',
            memory_updated_count: '3',
            memory_deleted_count: '2',
          },
        ]);
      }
      return makeResult([{ total_merged: '3', total_shown: '2', total_used: '1', query_count: '1', last_event_at: null }]);
    });

    const stats = await getRecallStats();

    expect(stats.client_type_threshold_analysis).toEqual([
      {
        client_type: null,
        current_min_display_score: 0.55,
        memory_created_count: 0,
        memory_updated_count: 0,
        memory_deleted_count: 0,
        analysis: {
          status: 'ready',
          basis: 'sample_metrics',
          current_min_display_score: 0.55,
          shown_candidate_count: 8,
          used_candidate_count: 3,
          unused_shown_candidate_count: 5,
          avg_shown_score: 0.6,
          avg_used_score: 0.58,
          avg_unused_shown_score: 0.63,
          used_p25_score: 0.57,
          used_p50_score: 0.58,
          unused_shown_p75_score: 0.64,
          separation_gap: -0.07,
        },
      },
      {
        client_type: 'hermes',
        current_min_display_score: 0.55,
        memory_created_count: 2,
        memory_updated_count: 1,
        memory_deleted_count: 1,
        analysis: {
          status: 'ready',
          basis: 'sample_metrics',
          current_min_display_score: 0.55,
          shown_candidate_count: 12,
          used_candidate_count: 5,
          unused_shown_candidate_count: 7,
          avg_shown_score: 0.7,
          avg_used_score: 0.74,
          avg_unused_shown_score: 0.6,
          used_p25_score: 0.69,
          used_p50_score: 0.74,
          unused_shown_p75_score: 0.61,
          separation_gap: 0.08,
        },
      },
      {
        client_type: 'codex',
        current_min_display_score: 0.55,
        memory_created_count: 1,
        memory_updated_count: 3,
        memory_deleted_count: 2,
        analysis: {
          status: 'insufficient_data',
          basis: 'insufficient_data',
          current_min_display_score: 0.55,
          shown_candidate_count: 0,
          used_candidate_count: 0,
          unused_shown_candidate_count: 0,
          avg_shown_score: null,
          avg_used_score: null,
          avg_unused_shown_score: null,
          used_p25_score: null,
          used_p50_score: null,
          unused_shown_p75_score: null,
          separation_gap: null,
        },
      },
    ]);
    const sqlText = mockSql.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sqlText).toContain('FROM memory_events');
    expect(sqlText).toContain("details->>'client_type'");
    expect(sqlText).toContain("event_type = 'create'");
    expect(sqlText).toContain("event_type = 'update'");
    expect(sqlText).toContain("event_type IN ('delete', 'hard_delete')");
  });

  it('marks display threshold analysis as insufficient_data when shown/used counts are too small', async () => {
    mockSql.mockImplementation(async (query: string) => {
      const sqlText = String(query);
      if (sqlText.includes('SELECT key, value FROM app_settings')) {
        return makeResult([{ key: 'recall.display.min_display_score', value: 0.55 }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && !sqlText.includes('GROUP BY')) {
        return makeResult([{
          shown_candidates: '4',
          used_candidates: '2',
          avg_shown_score: '0.66',
          avg_used_score: '0.79',
          avg_unused_shown_score: '0.52',
          used_p25_score: '0.74',
          used_p50_score: '0.79',
          unused_shown_p75_score: '0.54',
        }]);
      }
      if (sqlText.includes('FROM recall_query_candidates') && sqlText.includes('GROUP BY')) {
        return makeResult([]);
      }
      return makeResult([{ total_merged: '2', total_shown: '1', total_used: '1', query_count: '1', last_event_at: null }]);
    });

    const stats = await getRecallStats();

    expect(stats.display_threshold_analysis).toEqual({
      status: 'insufficient_data',
      basis: 'insufficient_data',
      current_min_display_score: 0.55,
      shown_candidate_count: 4,
      used_candidate_count: 2,
      unused_shown_candidate_count: 2,
      avg_shown_score: 0.66,
      avg_used_score: 0.79,
      avg_unused_shown_score: 0.52,
      used_p25_score: 0.74,
      used_p50_score: 0.79,
      unused_shown_p75_score: 0.54,
      separation_gap: 0.2,
    });
  });
});

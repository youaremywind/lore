import { fetchGlossarySemanticRows } from '../search/glossarySemantic';
import type { EmbeddingConfig } from '../core/types';
import { getBootUriSet } from '../memory/boot';
import { countQueryTokens } from '../view/viewBuilders';
import { embedTexts, resolveEmbeddingConfig } from '../view/embeddings';
import {
  fetchDenseMemoryViewRows,
  fetchExactMemoryRows,
  fetchLexicalMemoryViewRows,
} from '../view/memoryViewQueries';
import { ensureMemoryViewsReady } from '../view/viewCrud';
import {
  loadRecallDisplayConfig,
  loadRecallSafetyConfig,
  loadRecallScoringConfig,
} from './recallConfig';
import {
  buildRecallDisplay,
  type RecallDisplayItem,
  type RecallSuppressed,
} from './recallDisplay';
import { limitRecallQuery, resolveRecallQuery } from './recallQuery';
import {
  type ScoredResult,
  type ScoringConfig,
} from './recallScoring';

export interface RecallPipelineResult {
  query: string;
  retrieval_query: string;
  session_id: string | null;
  resolved_embedding: EmbeddingConfig;
  index: Record<string, unknown>;
  exact_rows: Record<string, unknown>[];
  glossary_semantic_rows: Record<string, unknown>[];
  dense_rows: Record<string, unknown>[];
  lexical_rows: Record<string, unknown>[];
  ranked: RecallDisplayItem[];
  candidates: RecallDisplayItem[];
  items: RecallDisplayItem[];
  suppressed: RecallSuppressed;
  boot_uris: string[];
  retrieval_meta: {
    exact_candidates: number;
    glossary_semantic_candidates: number;
    dense_candidates: number;
    lexical_candidates: number;
    model: string | null;
    strategy: string;
    query_tokens: number;
    query_chars: number;
    original_query_chars: number;
    query_truncated: boolean;
    query_char_limit: number;
    recency_enabled: boolean;
    view_types: string[];
  };
}

export interface RecallRequestBody {
  query?: string;
  embedding?: Partial<EmbeddingConfig> | null;
  session_id?: string | null;
  domain?: string | null;
  limit?: number;
  max_display_items?: number;
  min_display_score?: number;
  min_score?: number;
  score_precision?: number;
  exclude_boot_from_results?: boolean;
  log_events?: boolean;
  client_type?: string | null;
}

interface AggregateCandidatesOptions {
  exactRows: Record<string, unknown>[];
  glossarySemanticRows: Record<string, unknown>[];
  denseRows: Record<string, unknown>[];
  lexicalRows: Record<string, unknown>[];
  scoringConfig?: ScoringConfig | null;
  normalizedConfig?: ScoringConfig | null;
}

type AggregateCandidatesFn = (options: AggregateCandidatesOptions) => ScoredResult[];

interface RunRecallPipelineOptions {
  aggregateCandidates: AggregateCandidatesFn;
}

export async function runRecallPipeline(
  body: RecallRequestBody,
  { aggregateCandidates }: RunRecallPipelineOptions,
): Promise<RecallPipelineResult> {
  const rawQuery = body.query || '';
  const safetyConfig = await loadRecallSafetyConfig();
  const resolvedQuery = String(resolveRecallQuery(rawQuery) || '').trim();
  const limitedQuery = limitRecallQuery(resolvedQuery, safetyConfig.max_query_chars);
  const retrievalQuery = limitedQuery.query;

  const resolvedEmbedding = await resolveEmbeddingConfig(body?.embedding || null);
  const index = await ensureMemoryViewsReady();
  const scoringConfig = await loadRecallScoringConfig();
  const displayConfig = await loadRecallDisplayConfig();

  scoringConfig.query_tokens = await countQueryTokens(retrievalQuery);

  const [queryVector] = await embedTexts(resolvedEmbedding, [retrievalQuery]);
  const maxDisplayItems = Number(body.max_display_items ?? displayConfig.max_display_items);
  const candidateLimit = Math.max(body.limit || 12, maxDisplayItems, 1) * 8;

  const [exactRows, glossarySemanticRows, denseRows, lexicalRows] = await Promise.all([
    fetchExactMemoryRows({
      query: retrievalQuery,
      limit: candidateLimit,
      domain: body.domain || null,
    }),
    fetchGlossarySemanticRows({
      embedding: resolvedEmbedding,
      queryVector,
      limit: candidateLimit,
      domain: body.domain || null,
    }),
    fetchDenseMemoryViewRows({
      embedding: resolvedEmbedding,
      queryVector,
      limit: candidateLimit,
      domain: body.domain || null,
    }),
    fetchLexicalMemoryViewRows({
      query: retrievalQuery,
      limit: candidateLimit,
      domain: body.domain || null,
    }),
  ]);

  const bootUris = body.exclude_boot_from_results === false ? new Set<string>() : getBootUriSet();
  const scorePrecision = body.score_precision || 2;
  const minDisplayScore = Number(body.min_display_score ?? displayConfig.min_display_score);
  const { ranked, candidates, items, suppressed } = buildRecallDisplay({
    ranked: aggregateCandidates({
      exactRows: exactRows as unknown as Record<string, unknown>[],
      glossarySemanticRows: glossarySemanticRows as unknown as Record<string, unknown>[],
      denseRows: denseRows as unknown as Record<string, unknown>[],
      lexicalRows: lexicalRows as unknown as Record<string, unknown>[],
      scoringConfig,
    }),
    bootUris,
    scorePrecision,
    minScore: Number(body.min_score || 0),
    candidateCount: Math.max(body.limit || 12, maxDisplayItems),
    maxDisplayItems,
    minDisplayScore,
  });

  return {
    query: resolvedQuery,
    retrieval_query: retrievalQuery,
    session_id: body.session_id || null,
    resolved_embedding: resolvedEmbedding,
    index: index as Record<string, unknown>,
    exact_rows: exactRows as unknown as Record<string, unknown>[],
    glossary_semantic_rows: glossarySemanticRows as unknown as Record<string, unknown>[],
    dense_rows: denseRows as unknown as Record<string, unknown>[],
    lexical_rows: lexicalRows as unknown as Record<string, unknown>[],
    ranked,
    candidates,
    items,
    suppressed,
    boot_uris: Array.from(bootUris).toSorted(),
    retrieval_meta: {
      exact_candidates: exactRows.length,
      glossary_semantic_candidates: glossarySemanticRows.length,
      dense_candidates: denseRows.length,
      lexical_candidates: lexicalRows.length,
      model: resolvedEmbedding?.model || null,
      strategy: scoringConfig.strategy,
      query_tokens: scoringConfig.query_tokens as number,
      query_chars: limitedQuery.queryChars,
      original_query_chars: limitedQuery.originalQueryChars,
      query_truncated: limitedQuery.truncated,
      query_char_limit: limitedQuery.limit,
      recency_enabled: scoringConfig.recency_enabled,
      view_types: ['gist', 'question'],
    },
  };
}

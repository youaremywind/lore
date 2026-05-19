import { NextRequest, NextResponse } from 'next/server';
import { normalizeClientType, requireBearerAuth } from '../../../../server/auth';
import { jsonContractError } from '../../../../server/lore/contracts';
import { loadRecallSafetyConfig, recallMemories } from '../../../../server/lore/recall/recall';
import { limitRecallQuery, resolveRecallQuery } from '../../../../server/lore/recall/recallQuery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RECALL_TIMEOUT_MS = 2000;
const RECALL_QUERY_TRUNCATED_NOTICE =
  'User content is too long; recall only used the first {limit} characters. Use lore_search for detailed related memories.';
const RECALL_TIMEOUT_NOTICE =
  'Recall took longer than {seconds} seconds and was skipped. Use lore_search for detailed related memories.';

function noticeItem(uri: string, text: string): Record<string, unknown> {
  return {
    uri,
    score_display: null,
    score: null,
    cues: [text],
    matched_on: ['notice'],
  };
}

function withRecallNotices(payload: Record<string, unknown>): Record<string, unknown> {
  const meta = (payload.retrieval_meta && typeof payload.retrieval_meta === 'object')
    ? payload.retrieval_meta as Record<string, unknown>
    : {};
  const notices: Record<string, unknown>[] = [];

  if (meta.query_truncated === true) {
    const limit = Number(meta.query_char_limit || 200);
    notices.push(noticeItem(
      'notice://recall/query_truncated',
      RECALL_QUERY_TRUNCATED_NOTICE.replace('{limit}', String(limit)),
    ));
  }

  if (meta.recall_timed_out === true) {
    const seconds = Math.max(1, Math.round(Number(meta.timeout_ms || DEFAULT_RECALL_TIMEOUT_MS) / 1000));
    notices.push(noticeItem(
      'notice://recall/timeout',
      RECALL_TIMEOUT_NOTICE.replace('{seconds}', String(seconds)),
    ));
  }

  if (notices.length === 0) return payload;
  return {
    ...payload,
    items: [...notices, ...(Array.isArray(payload.items) ? payload.items : [])],
  };
}

function timeoutPayload(timeoutMs: number, body: Record<string, unknown>, maxQueryChars: number): Record<string, unknown> {
  const limitedQuery = limitRecallQuery(resolveRecallQuery(String(body?.query || '')), maxQueryChars);
  const retrievalMeta: Record<string, unknown> = {
    recall_timed_out: true,
    timeout_ms: timeoutMs,
  };
  if (limitedQuery.truncated) {
    retrievalMeta.query_chars = limitedQuery.queryChars;
    retrievalMeta.original_query_chars = limitedQuery.originalQueryChars;
    retrievalMeta.query_truncated = true;
    retrievalMeta.query_char_limit = limitedQuery.limit;
  }
  return {
    query: '',
    candidates: [],
    items: [],
    suppressed: { boot: 0, score: 0 },
    boot_uris: [],
    retrieval_meta: retrievalMeta,
    event_log: { enabled: false },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  body: Record<string, unknown>,
  maxQueryChars: number,
): Promise<T | Record<string, unknown>> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<Record<string, unknown>>((resolve) => {
        timeout = setTimeout(() => resolve(timeoutPayload(timeoutMs, body, maxQueryChars)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    const clientType = normalizeClientType(new URL(request.url).searchParams.get('client_type'));
    const safetyConfig = await loadRecallSafetyConfig();
    const payload = await withTimeout(
      recallMemories(body, { clientType }),
      safetyConfig.timeout_ms,
      body,
      safetyConfig.max_query_chars,
    );
    return NextResponse.json(withRecallNotices(payload as Record<string, unknown>));
  } catch (error) {
    return jsonContractError(error, 'Recall failed');
  }
}

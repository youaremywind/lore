import type { ClientType } from '../../auth';
import { recallMemories } from '../recall/recall';
import { extractNodeUris, formatBridgeRecallBlock } from './format';

export interface RecallBridgeInput {
  clientType: ClientType | null;
  sessionId?: string;
  prompt?: string;
}

export interface RecallBridgeResponse {
  context: string;
  query_id: string;
  node_uris: string[];
  has_recall: boolean;
  data: unknown;
}

export async function buildRecallBridge(input: RecallBridgeInput): Promise<RecallBridgeResponse> {
  const prompt = String(input.prompt || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  if (!prompt) {
    return { context: '', query_id: '', node_uris: [], has_recall: false, data: null };
  }

  const data = await recallMemories({ query: prompt, session_id: sessionId }, { clientType: input.clientType });
  const queryId = typeof data?.event_log?.query_id === 'string' ? data.event_log.query_id : '';
  const items = data?.items || [];
  const context = formatBridgeRecallBlock(items, sessionId, queryId);
  const nodeUris = extractNodeUris(items);
  return {
    context,
    query_id: queryId,
    node_uris: nodeUris,
    has_recall: Boolean(context),
    data,
  };
}

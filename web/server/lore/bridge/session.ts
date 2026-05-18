import { clearSessionReads } from '../memory/session';

export interface EndBridgeSessionInput {
  sessionId?: string;
}

export async function endBridgeSession(input: EndBridgeSessionInput): Promise<{ ok: true; session_id: string }> {
  const sessionId = String(input.sessionId || '').trim();
  if (sessionId) await clearSessionReads(sessionId);
  return { ok: true, session_id: sessionId };
}

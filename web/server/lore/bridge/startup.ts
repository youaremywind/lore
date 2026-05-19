import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ClientType } from '../../auth';
import { bootView } from '../memory/boot';
import { recallMemories } from '../recall/recall';
import { buildStartupQueries, formatBridgeBootSection, formatBridgeRecallBlock, joinBridgeContext, normalizeBridgeProject, type BridgeProject } from './format';

export interface StartupBridgeInput {
  clientType: ClientType | null;
  sessionId?: string;
  channel?: string;
  project?: unknown;
  includeGuidance?: boolean;
}

export interface StartupBridgeResponse {
  guidance: string;
  boot_context: string;
  startup_recall_context: string;
  system_context: string;
  meta: {
    client_type: ClientType | null;
    session_id: string;
    channel: string;
    queries: string[];
  };
}

function loadGuidance(): string {
  try {
    return readFileSync(join(process.cwd(), 'server', 'lore', 'guidance-reference.md'), 'utf8').trim();
  } catch {
    try {
      return readFileSync(join(process.cwd(), 'web', 'server', 'lore', 'guidance-reference.md'), 'utf8').trim();
    } catch {
      return '';
    }
  }
}

async function buildStartupRecallContext(queries: string[], clientType: ClientType | null): Promise<string> {
  const blocks: string[] = [];
  for (const query of queries) {
    try {
      const data = await recallMemories({ query, session_id: 'boot' }, { clientType });
      const queryId = typeof data?.event_log?.query_id === 'string' ? data.event_log.query_id : '';
      const block = formatBridgeRecallBlock(data?.items || [], 'boot', queryId);
      if (block) blocks.push(block);
    } catch {
      // Startup recall is best effort.
    }
  }
  return blocks.length > 0 ? `以下记忆节点与当前环境高度相关,建议提前读取。\n\n${blocks.join('\n\n')}` : '';
}

export async function buildStartupBridge(input: StartupBridgeInput): Promise<StartupBridgeResponse> {
  const clientType = input.clientType;
  const sessionId = String(input.sessionId || '').trim();
  const channel = String(input.channel || clientType || '').trim();
  const project: BridgeProject = normalizeBridgeProject(input.project);
  const queries = buildStartupQueries(channel, project);
  const [bootData, startupRecallContext] = await Promise.all([
    bootView({ client_type: clientType }),
    buildStartupRecallContext(queries, clientType),
  ]);
  const guidance = input.includeGuidance ? loadGuidance() : '';
  const bootContext = formatBridgeBootSection(bootData, clientType);
  return {
    guidance,
    boot_context: bootContext,
    startup_recall_context: startupRecallContext,
    system_context: joinBridgeContext([guidance, bootContext, startupRecallContext]),
    meta: {
      client_type: clientType,
      session_id: sessionId,
      channel,
      queries,
    },
  };
}

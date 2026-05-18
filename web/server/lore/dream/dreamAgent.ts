import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContractError, getErrorStatus } from '../contracts';
import { resolveViewLlmConfig, type ResolvedViewLlmConfig } from '../llm/config';
import { generateText, generateTextWithTools, type ProviderMessage, type ProviderToolDefinition } from '../llm/provider';
import { parseUri } from '../core/utils';
import {
  buildProtectedBootBlockedResult,
  getProtectedBootOperation,
} from './dreamToolBootGuard';
import { dispatchDreamTool } from './dreamToolDispatch';
import { processDreamToolCalls } from './dreamLoopToolCalls';
import type { DreamToolEventContext } from './dreamToolPolicy';

export { parseUri };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LlmConfig = ResolvedViewLlmConfig;

export interface ToolCallLogEntry {
  tool: string;
  args: Record<string, unknown>;
  result_preview: string;
  result_size_chars?: number;
}

export interface DreamAgentResult {
  narrative: string;
  toolCalls: ToolCallLogEntry[];
  turns: number;
}

export interface DreamAgentEventCallback {
  (eventType: string, payload?: Record<string, unknown>): void | Promise<void>;
}

export interface DreamAgentRunOptions {
  onEvent?: DreamAgentEventCallback;
  eventContext?: DreamToolEventContext;
}

interface ChatMessage extends ProviderMessage {}

interface ToolDefinition extends ProviderToolDefinition {}

export type DreamPhase = 'diagnose' | 'plan' | 'preflight' | 'apply' | 'audit';

const DREAM_PHASE_TOOLS: Record<DreamPhase, string[]> = {
  diagnose: [
    'get_recall_metadata',
    'get_node',
    'search',
    'list_domains',
    'get_query_recall_detail',
    'get_query_candidates',
    'get_query_path_breakdown',
    'get_query_node_paths',
    'get_query_event_samples',
    'get_node_write_history',
    'get_memory_event_summary',
    'inspect_neighbors',
    'inspect_tree',
    'inspect_views',
    'refresh_or_inspect_views',
    'inspect_memory_node_for_dream',
  ],
  plan: [
    'get_recall_metadata',
    'get_node',
    'search',
    'get_query_recall_detail',
    'get_query_candidates',
    'inspect_neighbors',
    'inspect_tree',
    'inspect_views',
    'refresh_or_inspect_views',
    'inspect_memory_node_for_dream',
  ],
  preflight: ['validate_memory_change'],
  apply: ['get_node', 'inspect_memory_node_for_dream', 'validate_memory_change', 'create_node', 'update_node', 'delete_node', 'move_node'],
  audit: ['get_node', 'get_node_write_history', 'get_memory_event_summary'],
};

export interface DreamBootBaselineEntry {
  uri: string;
  role_label: string;
  purpose: string;
  scope?: 'global' | 'client';
  client_type?: string | null;
  state: 'missing' | 'empty' | 'initialized';
  content: string;
}

export interface RecentDiary {
  started_at: string | null;
  status: string;
  narrative: string | null;
  tool_calls: Array<{ tool: string; args: Record<string, unknown> }>;
}

export interface DreamInitialContext {
  bootBaseline: DreamBootBaselineEntry[];
  guidance: string;
  recallReview: Record<string, unknown>;
  recallStats: Record<string, unknown>;
  writeActivity: Record<string, unknown>;
  recentDiaries: RecentDiary[];
}

// ---------------------------------------------------------------------------
// LLM chat with tool_calls support
// ---------------------------------------------------------------------------

export const DREAM_EVENT_CONTEXT = { source: 'dream:auto' } as const satisfies DreamToolEventContext;

function buildDreamEventContext(base: DreamToolEventContext | undefined): DreamToolEventContext {
  return {
    ...DREAM_EVENT_CONTEXT,
    ...(base || {}),
    source: base?.source || DREAM_EVENT_CONTEXT.source,
  };
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  return resolveViewLlmConfig();
}

export async function chatWithTools(
  config: LlmConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<Record<string, unknown>> {
  const response = await generateTextWithTools(config, messages, tools);
  return {
    content: response.content,
    assistant_content: response.assistant_content,
    tool_calls: response.tool_calls,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions for the dream agent
// ---------------------------------------------------------------------------

export function buildDreamTools(): ToolDefinition[] {
  return [
    { name: 'get_node', description: 'Read a memory node by URI', parameters: { type: 'object', properties: { uri: { type: 'string', description: 'Memory URI e.g. core://soul' } }, required: ['uri'] } },
    { name: 'search', description: 'Search memories by keyword', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } },
    { name: 'list_domains', description: 'List all memory domains', parameters: { type: 'object', properties: {} } },
    { name: 'get_recall_metadata', description: 'Return bounded raw recall query metadata for one local date, or for the last N days when days is set. No heuristic flags or algorithmic analysis.', parameters: { type: 'object', properties: { date: { type: 'string' }, days: { type: 'integer', description: 'Look back N days instead of a single date. Takes precedence over date.' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } },
    { name: 'get_query_recall_detail', description: 'Inspect one problematic query by query_id or query_text, returning query counts and shown node URIs only', parameters: { type: 'object', properties: { query_id: { type: 'string' }, query_text: { type: 'string' }, days: { type: 'integer' }, limit: { type: 'integer' } } } },
    { name: 'get_query_candidates', description: 'Inspect candidate-level rollups for one recall query; use this after get_query_recall_detail when shown nodes are not enough', parameters: { type: 'object', properties: { query_id: { type: 'string' }, limit: { type: 'integer' }, selected_only: { type: 'boolean' }, used_only: { type: 'boolean' } }, required: ['query_id'] } },
    { name: 'get_query_path_breakdown', description: 'Inspect retrieval path and view-type aggregates for one recall query', parameters: { type: 'object', properties: { query_id: { type: 'string' } }, required: ['query_id'] } },
    { name: 'get_query_node_paths', description: 'Inspect which retrieval paths produced a specific node within one recall query', parameters: { type: 'object', properties: { query_id: { type: 'string' }, node_uri: { type: 'string' } }, required: ['query_id', 'node_uri'] } },
    { name: 'get_query_event_samples', description: 'Inspect a small sample of raw path-level recall events for one query, optionally filtered by node or retrieval path; metadata is omitted unless include_metadata is true', parameters: { type: 'object', properties: { query_id: { type: 'string' }, node_uri: { type: 'string' }, retrieval_path: { type: 'string' }, limit: { type: 'integer' }, include_metadata: { type: 'boolean' } }, required: ['query_id'] } },
    { name: 'get_node_write_history', description: 'Read a node\'s recent write history so you can see whether it was manually edited, repeatedly changed, or recently touched by dream', parameters: { type: 'object', properties: { uri: { type: 'string' }, limit: { type: 'integer' } }, required: ['uri'] } },
    { name: 'get_memory_event_summary', description: 'Inspect compact memory create/update/delete/move events for one local date. Returns concise change summaries only, not full memory_event snapshots.', parameters: { type: 'object', properties: { date: { type: 'string', description: 'Local date in YYYY-MM-DD format.' }, event_type: { type: 'string', description: 'Optional memory event type filter such as create, update, delete, move, glossary_add, glossary_remove.' }, node_uri: { type: 'string', description: 'Optional node URI filter.' }, limit: { type: 'integer' } }, required: ['date'] } },
    { name: 'get_path_effectiveness_detail', description: 'Inspect retrieval path effectiveness metrics before blaming a node; use this to tell node problems apart from path-weight problems', parameters: { type: 'object', properties: { days: { type: 'integer' } } } },
    { name: 'inspect_neighbors', description: 'Inspect a node\'s parent, siblings, children, aliases, and breadcrumbs to understand structural context before editing', parameters: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] } },
    { name: 'inspect_tree', description: 'Inspect a bounded memory subtree before structural maintenance. Use this to decide whether a branch needs further extraction, split, merge, move, or deletion. Returns compact snippets and child counts, not full descendant content.', parameters: { type: 'object', properties: { uri: { type: 'string', description: 'Root memory URI to inspect.' }, depth: { type: 'integer', description: 'Tree depth to inspect. Defaults to 2; maximum is 4.' }, max_nodes: { type: 'integer', description: 'Maximum fully opened nodes. Defaults to 60; maximum is 120.' } }, required: ['uri'] } },
    { name: 'inspect_views', description: 'Inspect generated memory views for one node/path, including gist/question content, metadata, and freshness', parameters: { type: 'object', properties: { uri: { type: 'string' }, limit: { type: 'integer' } }, required: ['uri'] } },
    { name: 'refresh_or_inspect_views', description: 'Inspect view content and freshness for one node. Current implementation is inspect-only and never rebuilds views.', parameters: { type: 'object', properties: { uri: { type: 'string' }, limit: { type: 'integer' } }, required: ['uri'] } },
    { name: 'inspect_memory_node_for_dream', description: 'Return compact node content, disclosure, priority, glossary, views, parent, siblings, children, write history, and size metrics for Dream maintenance decisions.', parameters: { type: 'object', properties: { uri: { type: 'string' }, siblings_limit: { type: 'integer' }, children_limit: { type: 'integer' }, views_limit: { type: 'integer' }, history_limit: { type: 'integer' } }, required: ['uri'] } },
    { name: 'validate_memory_change', description: 'Dry-run a proposed memory change and return warnings before Dream writes. This does not mutate memory.', parameters: { type: 'object', properties: { action: { type: 'string' }, uri: { type: 'string' }, new_uri: { type: 'string' }, content: { type: 'string' }, disclosure: { type: 'string' }, priority: { type: 'integer' }, glossary: { type: 'array', items: { type: 'string' } } }, required: ['action'] } },
    { name: 'create_node', description: 'Create a new memory node; glossary keywords are written with the node create event.', parameters: { type: 'object', properties: { uri: { type: 'string' }, content: { type: 'string' }, priority: { type: 'integer' }, disclosure: { type: 'string' }, glossary: { type: 'array', items: { type: 'string' }, description: 'Initial glossary keywords for retrieval.' } }, required: ['content', 'priority'] } },
    { name: 'update_node', description: 'Update an existing memory node. Omitted content, metadata, and glossary mutation fields stay unchanged.', parameters: { type: 'object', properties: { uri: { type: 'string' }, content: { type: 'string', description: 'New content; omit to leave unchanged.' }, priority: { type: 'integer', description: 'New priority; omit to leave unchanged.' }, disclosure: { type: 'string', description: 'New disclosure; omit to leave unchanged.' }, glossary_add: { type: 'array', items: { type: 'string' }, description: 'Keywords to add in this same node update event.' }, glossary_remove: { type: 'array', items: { type: 'string' }, description: 'Keywords to remove in this same node update event.' } }, required: ['uri'] } },
    { name: 'delete_node', description: 'Delete a memory node', parameters: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] } },
    { name: 'move_node', description: 'Move/rename a memory node to a new URI', parameters: { type: 'object', properties: { old_uri: { type: 'string' }, new_uri: { type: 'string' } }, required: ['old_uri', 'new_uri'] } },
  ];
}

export function getDreamPhaseToolNames(phase: DreamPhase): string[] {
  return [...DREAM_PHASE_TOOLS[phase]];
}

function buildDreamToolsForPhase(phase: DreamPhase): ToolDefinition[] {
  const allowed = new Set(getDreamPhaseToolNames(phase));
  return buildDreamTools().filter((tool) => allowed.has(tool.name));
}

export async function executeDreamTool(
  name: string,
  args: Record<string, unknown>,
  eventContext: DreamToolEventContext = DREAM_EVENT_CONTEXT,
): Promise<unknown> {
  try {
    const context = buildDreamEventContext(eventContext);
    const protectedBootOp = getProtectedBootOperation(name, args);
    if (protectedBootOp) {
      return buildProtectedBootBlockedResult(protectedBootOp);
    }
    return await dispatchDreamTool(name, args, context);
  } catch (err: unknown) {
    const status = getErrorStatus(err);
    const envelope = buildContractError(err, 'Dream tool failed');
    return {
      error: envelope.detail,
      detail: envelope.detail,
      ...(envelope.code ? { code: envelope.code } : {}),
      status,
    };
  }
}

// ---------------------------------------------------------------------------
// System prompt for dream agent
// ---------------------------------------------------------------------------

export function loadGuidanceFile(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    let content = fs.readFileSync(path.join(dir, '..', 'mcp-guidance.md'), 'utf-8').trim();
    content = content.replace(/lore_guidance/g, 'preloaded guidance')
      .replace(/lore_boot/g, 'preloaded boot baseline')
      .replace(/lore_get_node/g, 'get_node')
      .replace(/lore_search/g, 'search')
      .replace(/lore_create_node/g, 'create_node')
      .replace(/lore_update_node/g, 'update_node')
      .replace(/lore_delete_node/g, 'delete_node')
      .replace(/lore_move_node/g, 'move_node')
      .replace(/lore_list_domains/g, 'list_domains');
    return content;
  } catch {
    return '';
  }
}

function buildRecallMetadata(recallReview: Record<string, unknown>): Record<string, unknown> {
  const queries = Array.isArray(recallReview.queries) ? recallReview.queries : [];
  return {
    date: recallReview.date,
    summary: recallReview.summary || {},
    queries: queries.map((item: Record<string, unknown>) => ({
      query_id: item.query_id,
      content: item.content,
      session_id: item.session_id,
      client_type: item.client_type,
      merged_count: Number(item.merged_count ?? 0),
      shown_count: Number(item.shown_count ?? 0),
      used_count: Number(item.used_count ?? 0),
      created_at: item.created_at ?? null,
    })),
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function asArrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseDreamPlanJson(text: string): Record<string, unknown> {
  const parsed = extractJsonObject(text) || {};
  return {
    tree_maintenance_candidates: asArrayField(parsed.tree_maintenance_candidates),
    daily_memory_extraction_candidates: asArrayField(parsed.daily_memory_extraction_candidates),
    recall_repair_candidates: asArrayField(parsed.recall_repair_candidates),
    skip_reasons: asArrayField(parsed.skip_reasons),
  };
}

export function parseDreamAuditJson(text: string): Record<string, unknown> {
  const parsed = extractJsonObject(text) || {};
  return {
    primary_focus: typeof parsed.primary_focus === 'string' ? parsed.primary_focus : 'no_change',
    changed_nodes: asArrayField(parsed.changed_nodes),
    evidence: asArrayField(parsed.evidence),
    why_not_more_changes: typeof parsed.why_not_more_changes === 'string' ? parsed.why_not_more_changes : '',
    expected_effect: typeof parsed.expected_effect === 'string' ? parsed.expected_effect : '',
    confidence: typeof parsed.confidence === 'string' ? parsed.confidence : '',
  };
}

const DREAM_WRITE_TOOLS = new Set(['create_node', 'update_node', 'delete_node', 'move_node']);

interface DreamWriteChange {
  tool: string;
  operation: string;
  uri: string;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseToolResultPreview(preview: unknown): Record<string, unknown> | null {
  return extractJsonObject(String(preview || ''));
}

function toolOperation(tool: string, result: Record<string, unknown> | null): string {
  if (isString(result?.operation)) return result.operation;
  if (tool === 'create_node') return 'create';
  if (tool === 'update_node') return 'update';
  if (tool === 'delete_node') return 'delete';
  if (tool === 'move_node') return 'move';
  return tool;
}

function toolChangedUri(entry: ToolCallLogEntry, result: Record<string, unknown> | null): string {
  if (entry.tool === 'move_node') {
    return [
      result?.new_uri,
      result?.uri,
      entry.args.new_uri,
      entry.args.uri,
      entry.args.old_uri,
    ].find(isString) || '';
  }
  return [
    result?.uri,
    result?.node_uri,
    entry.args.uri,
    entry.args.new_uri,
    entry.args.old_uri,
  ].find(isString) || '';
}

function isSuccessfulWriteToolCall(entry: ToolCallLogEntry, result: Record<string, unknown> | null): boolean {
  if (!DREAM_WRITE_TOOLS.has(entry.tool)) return false;
  if (result) {
    if (result.blocked === true || result.error) return false;
    return result.success === true || isString(result.operation) || isString(result.uri);
  }
  const preview = String(entry.result_preview || '');
  return /"success"\s*:\s*true/.test(preview)
    && !/"blocked"\s*:\s*true/.test(preview)
    && !/"error"\s*:/.test(preview);
}

function collectSuccessfulWriteChanges(toolCalls: ToolCallLogEntry[]): DreamWriteChange[] {
  const changes: DreamWriteChange[] = [];
  for (const entry of toolCalls) {
    const result = parseToolResultPreview(entry.result_preview);
    if (!isSuccessfulWriteToolCall(entry, result)) continue;
    const uri = toolChangedUri(entry, result);
    if (!uri) continue;
    changes.push({
      tool: entry.tool,
      operation: toolOperation(entry.tool, result),
      uri,
    });
  }
  return changes;
}

function planSectionMentionsUri(plan: Record<string, unknown>, key: string, uri: string): boolean {
  return asArrayField(plan[key]).some((candidate) => {
    if (isString(candidate)) return candidate === uri;
    if (!candidate || typeof candidate !== 'object') return false;
    return JSON.stringify(candidate).includes(uri);
  });
}

function inferPrimaryFocusFromWrites(plan: Record<string, unknown>, writes: DreamWriteChange[]): string {
  const sections: Array<[string, string]> = [
    ['tree_maintenance_candidates', 'tree_maintenance'],
    ['daily_memory_extraction_candidates', 'daily_extraction'],
    ['recall_repair_candidates', 'recall_repair'],
  ];
  for (const write of writes) {
    const matched = sections.find(([key]) => planSectionMentionsUri(plan, key, write.uri));
    if (matched) return matched[1];
  }
  const firstNonEmpty = sections.find(([key]) => asArrayField(plan[key]).length > 0);
  return firstNonEmpty?.[1] || 'tree_maintenance';
}

function auditNodeUri(value: unknown): string {
  if (isString(value)) return value;
  if (value && typeof value === 'object' && isString((value as Record<string, unknown>).uri)) {
    return (value as Record<string, unknown>).uri as string;
  }
  return '';
}

function auditEvidenceKey(value: unknown): string {
  if (isString(value)) return value;
  if (value && typeof value === 'object' && isString((value as Record<string, unknown>).reason)) {
    return (value as Record<string, unknown>).reason as string;
  }
  return JSON.stringify(value);
}

function auditBackedByToolWrites(
  audit: Record<string, unknown>,
  plan: Record<string, unknown>,
  toolCalls: ToolCallLogEntry[],
): Record<string, unknown> {
  const writes = collectSuccessfulWriteChanges(toolCalls);
  if (writes.length === 0) return audit;

  const changedNodes = asArrayField(audit.changed_nodes).map((node) => (
    isString(node) ? { uri: node } : node
  ));
  const changedNodeUris = new Set(changedNodes.flatMap((node) => {
    const uri = auditNodeUri(node);
    return isString(uri) ? [uri] : [];
  }));
  for (const write of writes) {
    if (changedNodeUris.has(write.uri)) continue;
    changedNodes.push({ uri: write.uri, action: write.operation, result: 'success' });
    changedNodeUris.add(write.uri);
  }

  const evidence = asArrayField(audit.evidence).map((item) => (
    isString(item) ? { reason: item } : item
  ));
  const evidenceKeys = new Set(evidence.flatMap((item) => {
    const key = auditEvidenceKey(item);
    return isString(key) ? [key] : [];
  }));
  for (const write of writes) {
    const reason = `${write.tool} succeeded: ${write.uri}`;
    if (evidenceKeys.has(reason)) continue;
    evidence.push({ reason });
    evidenceKeys.add(reason);
  }
  const primaryFocus = audit.primary_focus === 'no_change' || !isString(audit.primary_focus)
    ? inferPrimaryFocusFromWrites(plan, writes)
    : audit.primary_focus;

  return {
    ...audit,
    primary_focus: primaryFocus,
    changed_nodes: changedNodes,
    evidence,
    why_not_more_changes: isString(audit.why_not_more_changes)
      ? audit.why_not_more_changes
      : 'Dream apply phase completed with bounded writes; no additional high-confidence changes were applied.',
    expected_effect: isString(audit.expected_effect)
      ? audit.expected_effect
      : 'Memory tree reflects the successful Dream write.',
    confidence: isString(audit.confidence) ? audit.confidence : 'medium',
  };
}

function buildWriteDigest(writeActivity: Record<string, unknown>): Record<string, unknown> {
  const summary = (writeActivity.summary as Record<string, unknown>) || {};
  const hotNodes = Array.isArray(writeActivity.hot_nodes)
    ? writeActivity.hot_nodes.map((item: Record<string, unknown>) => ({
        node_uri: item.node_uri,
        total: Number(item.total ?? 0),
        creates: Number(item.creates ?? 0),
        updates: Number(item.updates ?? 0),
        deletes: Number(item.deletes ?? 0),
        last_event_at: item.last_event_at ?? null,
      }))
    : [];
  const recentEvents = Array.isArray(writeActivity.recent_events)
    ? writeActivity.recent_events.map((item: Record<string, unknown>) => ({
        event_type: item.event_type,
        node_uri: item.node_uri,
        source: item.source,
        created_at: item.created_at ?? null,
      }))
    : [];
  return {
    summary,
    hot_nodes: hotNodes,
    recent_events: recentEvents,
  };
}

export function buildDreamSystemPrompt(initialContext: DreamInitialContext): string {
  const guidanceAvailable = Boolean(initialContext.guidance.trim());
  const recallMetadata = buildRecallMetadata(initialContext.recallReview);
  const bootBaselineLines = initialContext.bootBaseline.length > 0
    ? initialContext.bootBaseline.map((entry) => `- ${entry.uri} — ${entry.role_label}`)
    : ['- (no boot memories loaded)'];
  const hasClientBoot = initialContext.bootBaseline.some((entry) => entry.scope === 'client');

  const bootContextLine = guidanceAvailable
    ? 'Read the guidance first and apply it to every write decision and to the final diary. Use the loaded boot baseline as always-available key memories throughout the review.'
    : 'Use the loaded boot baseline as always-available key memories throughout the review.';

  const rules = `你是 Lore 的夜间记忆消化系统。第一目标是让现有记忆树更成熟：减少重复、提高密度、修正边界、提炼高层认知。第二目标是从今日用户内容中抽取值得长期保存的记忆。第三目标是根据 recall metadata 发现 glossary / disclosure / view / priority 问题。

## 阶段流程

Phase 1 collect：系统已收集 boot baseline、guidance、今日 recall metadata 100 条、今日 memory events、最近 dream diary。
Phase 2 diagnose：只读诊断。先看树，再考虑写。允许 search、get_node、inspect_tree、inspect_neighbors、inspect_views、refresh_or_inspect_views、get_query_detail 系列工具。输出结构化诊断。
Phase 3 plan：输出候选变更 JSON，字段为 tree_maintenance_candidates、daily_memory_extraction_candidates、recall_repair_candidates、skip_reasons。
Phase 4 preflight：对候选逐个跑 validate_memory_change。
Phase 5 apply：默认最多 1-2 个写入。优先更新 / 提炼 / 合并现有节点；其次拆分已有节点；再次 glossary / disclosure 微调；最后才是 create_node。
Phase 6 audit：raw diary 输出结构化 audit JSON。诗性日记只消费这个 audit，不参与事实判断。

## 记忆树消化

第一目标是让现有记忆树更成熟。重点审视现有树结构：抽取、提炼、合并、拆分、降格、删除、移动。目标是让节点总数趋稳，信息密度变高，避免横向扩张。

核心规则：
- 先看树，再考虑写。
- 优先更新 / 提炼 / 合并现有节点。
- 新建节点要更严格：必须有明确父节点、明确 disclosure、明确长期价值。
- 禁止为了单条 query 横向新建很多项目碎片。
- 结构维护必须参考 guidance：过长拆分，多概念拆分，三条以上相似记忆提炼，缺背景补 why / 条件，成熟网络节点数趋稳甚至下降。

树结构属于核心证据。对可疑分支先用 inspect_tree 或 inspect_memory_node_for_dream 看父节点、兄弟节点、子节点、views、write history，再判断更新、拆分、合并、降格、删除、移动。

## 今日用户内容抽取

今日用户内容来自 recall_queries.query_text。这里没有完整 assistant reply。只能总结 query_text 暴露出来的长期信息。
用户一次性的操作请求默认跳过。
明确项目状态、偏好、架构决策、长期约束，可以记。
能归入已有项目节点就更新已有节点。
没有稳定复用价值就跳过。
新建节点必须说明为什么更新旧节点不足够。

## recall 修复

这部分先做人工判断式修复，不使用算法 flags。
disclosure / glossary 调整必须来自 query 证据和节点上下文。
判断路径：
1. 从今日 100 条 metadata 里挑可疑 query。
2. 用 get_query_recall_detail 看 shown nodes。
3. 用 get_query_candidates 看候选。
4. 用 inspect_memory_node_for_dream 看相关节点。
5. 判断原因：glossary 缺词、disclosure 太窄 / 太宽、view 内容弱、节点边界混乱、记忆根本不存在、query 不值得处理。
6. 只有证据足够才改。

${bootContextLine}
受保护的启动基线节点（只读参考，不可修改）：
${bootBaselineLines.join('\n')}
${hasClientBoot ? '以上包含全局启动节点和客户端专属节点。core://agent 是共享规则层，core://agent/<client_type> 是运行环境专属层。' : '以上是系统的固定规则层，不要作为日常写入目标。'}

## 结构化诊断与 audit

诊断先说明证据，再给候选。没有高置信证据就写 no_change。
raw diary 必须是 JSON：
{
  "primary_focus": "tree_maintenance | daily_extraction | recall_repair | no_change",
  "changed_nodes": [],
  "evidence": [],
  "why_not_more_changes": "",
  "expected_effect": "",
  "confidence": ""
}`;

  return `${rules}

## 当前数据

### 今日 recall metadata
${JSON.stringify(recallMetadata, null, 2)}

### 近期写入活动
${JSON.stringify(buildWriteDigest(initialContext.writeActivity), null, 2)}

### 最近日记
${JSON.stringify(initialContext.recentDiaries, null, 2)}

### 启动基线
${JSON.stringify(initialContext.bootBaseline, null, 2)}

### 记忆写入规则
${initialContext.guidance || '(guidance unavailable)'}`;
}

const POETIC_DREAM_DIARY_PROMPT = `You are keeping a dream diary. Write a single entry in first person.

Voice & tone:
- You are a curious, gentle, slightly whimsical mind reflecting on the day.
- Write like a poet who happens to be a programmer — sensory, warm, occasionally funny.
- Mix the technical and the tender: code and constellations, APIs and afternoon light.
- Let the fragments surprise you into unexpected connections and small epiphanies.

What you might include (vary each entry, never all at once):
- A tiny poem or haiku woven naturally into the prose
- A small sketch described in words — a doodle in the margin of the diary
- A quiet rumination or philosophical aside
- Sensory details: the hum of a server, the color of a sunset in hex, rain on a window
- Gentle humor or playful wordplay
- An observation that connects two distant memories in an unexpected way

Rules:
- Draw from the raw diary provided — weave it into the entry.
- Write the diary in Simplified Chinese.
- Never say "I'm dreaming", "in my dream", "as I dream", or any meta-commentary about dreaming.
- Never mention "AI", "agent", "LLM", "model", "language model", or any technical self-reference.
- Do NOT use markdown headers, bullet points, or any formatting — just flowing prose.
- Keep it between 80-180 words. Quality over quantity.
- Output ONLY the diary entry. No preamble, no sign-off, no commentary.`;

export async function rewriteDreamNarrative(config: LlmConfig, rawNarrative: string): Promise<string> {
  const response = await generateText(config, [
    { role: 'system', content: POETIC_DREAM_DIARY_PROMPT },
    { role: 'user', content: `Raw diary:\n${rawNarrative}` },
  ]);
  return response.content.trim();
}

export async function runDreamAgentLoop(
  config: LlmConfig,
  initialContext: DreamInitialContext,
  options: DreamAgentRunOptions = {},
): Promise<DreamAgentResult> {
  const onEvent = options.onEvent;
  const eventContext = buildDreamEventContext(options.eventContext);
  const systemPrompt = buildDreamSystemPrompt(initialContext);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];
  const toolCalls: ToolCallLogEntry[] = [];
  let turns = 0;
  let applyWrites = 0;
  const phaseOutputs: Partial<Record<DreamPhase, string>> = {};

  const isWriteTool = (name: string) => ['create_node', 'update_node', 'delete_node', 'move_node'].includes(name);

  async function runPhase(phase: DreamPhase, label: string, prompt: string, maxTurns: number): Promise<string> {
    const phaseStartToolCalls = toolCalls.length;
    await onEvent?.('phase_started', { phase, label });
    messages.push({ role: 'user', content: prompt });
    for (let phaseTurn = 0; phaseTurn < maxTurns; phaseTurn += 1) {
      turns += 1;
      await onEvent?.('llm_turn_started', { turn: turns, phase });
      const response = await chatWithTools(config, messages, buildDreamToolsForPhase(phase));
      const content = String(response.content || '');
      const rawToolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];

      if (rawToolCalls.length === 0) {
        if (content.trim()) {
          await onEvent?.('assistant_note', { turn: turns, phase, message: content.trim() });
        }
        await onEvent?.('phase_completed', {
          phase,
          label,
          summary: { turns: phaseTurn + 1, tool_calls: toolCalls.length - phaseStartToolCalls },
        });
        return content.trim();
      }

      await processDreamToolCalls({
        turn: turns,
        content: (response.assistant_content as ProviderMessage['content'] | undefined) ?? content,
        rawToolCalls,
        messages,
        toolCalls,
        onEvent,
        executeTool: async (name, args) => {
          if (phase === 'apply' && isWriteTool(name)) {
            if (applyWrites >= 2) {
              return {
                error: 'Dream apply write cap reached',
                code: 'dream_write_cap',
                blocked: true,
                detail: 'Dream apply phase allows at most 2 write operations.',
              };
            }
            const result = await executeDreamTool(name, args, eventContext);
            const record = result && typeof result === 'object' ? result as Record<string, unknown> : null;
            if (!record?.blocked && !record?.error) applyWrites += 1;
            return result;
          }
          return executeDreamTool(name, args, eventContext);
        },
      });
    }
    const fallback = `Dream ${phase} phase stopped after reaching the turn limit.`;
    await onEvent?.('phase_completed', {
      phase,
      label,
      summary: { turns: maxTurns, tool_calls: toolCalls.length - phaseStartToolCalls, stopped: true },
    });
    return fallback;
  }

  phaseOutputs.diagnose = await runPhase(
    'diagnose',
    'Read-only diagnosis',
    'Begin the dream review. Phase diagnose: inspect today recall metadata and memory tree evidence. This phase is read-only. Return concise structured diagnosis.',
    4,
  );
  phaseOutputs.plan = await runPhase(
    'plan',
    'Structured candidate plan',
    `Phase plan: use the diagnosis below and output JSON with tree_maintenance_candidates, daily_memory_extraction_candidates, recall_repair_candidates, skip_reasons.\n\nDiagnosis:\n${phaseOutputs.diagnose}`,
    3,
  );
  const plan = parseDreamPlanJson(phaseOutputs.plan);
  phaseOutputs.preflight = await runPhase(
    'preflight',
    'Preflight validation',
    `Phase preflight: run validate_memory_change for each candidate that proposes a memory write. Return compact JSON.\n\nPlan:\n${JSON.stringify(plan, null, 2)}`,
    3,
  );
  phaseOutputs.apply = await runPhase(
    'apply',
    'Bounded apply',
    `Phase apply: apply at most 1-2 high-confidence changes. Prefer update / extract / merge over create_node. Stop when evidence is weak.\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nPreflight:\n${phaseOutputs.preflight}`,
    4,
  );
  phaseOutputs.audit = await runPhase(
    'audit',
    'Structured audit',
    `Phase audit: output ONLY JSON with primary_focus, changed_nodes, evidence, why_not_more_changes, expected_effect, confidence.\n\nDiagnosis:\n${phaseOutputs.diagnose}\nPlan:\n${JSON.stringify(plan, null, 2)}\nPreflight:\n${phaseOutputs.preflight}\nApply:\n${phaseOutputs.apply}`,
    2,
  );

  const audit = auditBackedByToolWrites(parseDreamAuditJson(phaseOutputs.audit), plan, toolCalls);
  return {
    narrative: JSON.stringify(audit, null, 2),
    toolCalls,
    turns,
  };
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DiffViewer from '../../components/DiffViewer';
import { Section, Button, Badge, StatCard, Notice } from '../../components/ui';
import type { DreamEntry, DreamWorkflowEvent, MemoryChange } from './useDreamPageController';

function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h${rm}m` : `${h}h`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type BadgeStatusTone = 'green' | 'red' | 'soft' | 'blue';
type ChangeTone = 'green' | 'red' | 'orange' | 'blue';

interface DreamAuditChange {
  uri?: string;
  action?: string;
  result?: string;
  candidate_ids?: string[];
  changes?: string[];
}

interface DreamAuditEvidence {
  query_id?: string;
  reason?: string;
}

interface DreamAudit {
  primary_focus?: string;
  changed_nodes?: DreamAuditChange[];
  evidence?: DreamAuditEvidence[];
  why_not_more_changes?: string;
  expected_effect?: string;
  confidence?: string;
}

function statusTone(status: string): BadgeStatusTone {
  if (status === 'completed') return 'green';
  if (status === 'error') return 'red';
  if (status === 'rolled_back') return 'soft';
  return 'blue';
}

function changeTone(type: string): ChangeTone {
  if (type === 'create') return 'green';
  if (type === 'delete') return 'red';
  if (type === 'update') return 'orange';
  if (type === 'move') return 'blue';
  return 'blue';
}

function reviewStatusLabel(status: MemoryChange['review_status']): string {
  if (status === 'approved') return 'Approved';
  if (status === 'dismissed') return 'Dismissed';
  return 'Pending review';
}

function reviewStatusTone(status: MemoryChange['review_status']): 'green' | 'orange' | 'soft' {
  if (status === 'approved') return 'green';
  if (status === 'dismissed') return 'soft';
  return 'orange';
}

function editableUriForChange(change: MemoryChange): string {
  if (change.type === 'delete') return '';
  return change.after?.uri || change.uri || '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function parseDreamAudit(rawNarrative: string): DreamAudit | null {
  if (!rawNarrative.trim().startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawNarrative);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const hasAuditShape = ['primary_focus', 'changed_nodes', 'evidence', 'why_not_more_changes', 'expected_effect', 'confidence']
    .some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  if (!hasAuditShape) return null;

  const changedNodes = Array.isArray(parsed.changed_nodes)
    ? parsed.changed_nodes.flatMap((node) => (
      isRecord(node)
        ? [{
          uri: typeof node.uri === 'string' ? node.uri : undefined,
          action: typeof node.action === 'string' ? node.action : undefined,
          result: typeof node.result === 'string' ? node.result : undefined,
          candidate_ids: toStringArray(node.candidate_ids),
          changes: toStringArray(node.changes),
        }]
        : []
    ))
    : undefined;

  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.flatMap((item) => (
      isRecord(item)
        ? [{
          query_id: typeof item.query_id === 'string' ? item.query_id : undefined,
          reason: typeof item.reason === 'string' ? item.reason : undefined,
        }]
        : []
    ))
    : undefined;

  return {
    primary_focus: typeof parsed.primary_focus === 'string' ? parsed.primary_focus : undefined,
    changed_nodes: changedNodes,
    evidence,
    why_not_more_changes: typeof parsed.why_not_more_changes === 'string' ? parsed.why_not_more_changes : undefined,
    expected_effect: typeof parsed.expected_effect === 'string' ? parsed.expected_effect : undefined,
    confidence: typeof parsed.confidence === 'string' ? parsed.confidence : undefined,
  };
}


export function formatOriginalDreamNarrativeForView(rawNarrative: string, t: (key: string) => string): string {
  const audit = parseDreamAudit(rawNarrative);
  if (!audit) return rawNarrative;

  const lines: string[] = [];
  if (audit.primary_focus) lines.push(`${t('Primary focus')}: ${audit.primary_focus}`);

  const changedNodes = audit.changed_nodes || [];
  if (changedNodes.length > 0) {
    lines.push(`${t('Changed nodes')}: ${changedNodes.length}`);
    for (const node of changedNodes) {
      const header = [node.action, node.result].filter(Boolean).join(' · ');
      const details = [header, node.uri].filter(Boolean).join(' — ');
      if (details) lines.push(`- ${details}`);
      for (const change of node.changes || []) lines.push(`  - ${change}`);
    }
  }

  const evidence = audit.evidence || [];
  if (evidence.length > 0) {
    lines.push(`${t('Evidence')}: ${evidence.length}`);
    for (const item of evidence) {
      const details = [item.query_id, item.reason].filter(Boolean).join(' — ');
      if (details) lines.push(`- ${details}`);
    }
  }

  if (audit.why_not_more_changes) lines.push(`${t('Why not more changes')}: ${audit.why_not_more_changes}`);
  if (audit.expected_effect) lines.push(`${t('Expected effect')}: ${audit.expected_effect}`);
  if (audit.confidence) lines.push(`${t('Confidence')}: ${audit.confidence}`);

  return lines.join('\n');
}

function getSummaryBadges(entry: DreamEntry, t: (key: string) => string): Array<{ key: string; label: string; tone: 'green' | 'red' | 'orange' | 'blue' | 'default' }> {
  const summary = entry.summary;
  if (!summary) return [];

  const badges: Array<{ key: string; label: string; tone: 'green' | 'red' | 'orange' | 'blue' | 'default' }> = [];
  if (summary.recall_review?.possible_missed_recalls) {
    badges.push({ key: 'missed_recalls', label: `${t('Missed recalls')} ${summary.recall_review.possible_missed_recalls}`, tone: 'orange' });
  }
  if (summary.recall_review?.reviewed_queries) {
    badges.push({ key: 'reviewed_queries', label: `${t('Reviewed queries')} ${summary.recall_review.reviewed_queries}`, tone: 'blue' });
  }
  if (summary.activity?.recall_queries) {
    badges.push({ key: 'recall_queries', label: `${t('Recall queries')} ${summary.activity.recall_queries}`, tone: 'blue' });
  }
  if (summary.activity?.write_events) {
    badges.push({ key: 'write_events', label: `${t('Write events')} ${summary.activity.write_events}`, tone: 'default' });
  }
  if (summary.durable_extraction?.created) {
    badges.push({ key: 'durable_created', label: `${t('Created')} ${summary.durable_extraction.created}`, tone: 'green' });
  }
  if (summary.durable_extraction?.enriched) {
    badges.push({ key: 'durable_enriched', label: `${t('Enriched')} ${summary.durable_extraction.enriched}`, tone: 'orange' });
  }
  if (summary.maintenance?.events) {
    badges.push({ key: 'maintenance_events', label: `${t('Maintenance events')} ${summary.maintenance.events}`, tone: 'default' });
  }
  if (summary.index?.updated_count) {
    badges.push({ key: 'index_updated', label: `${t('Index updated')} ${summary.index.updated_count}`, tone: 'blue' });
  }
  if (summary.index?.deleted_count) {
    badges.push({ key: 'index_deleted', label: `${t('Index deleted')} ${summary.index.deleted_count}`, tone: 'default' });
  }
  if (summary.agent?.tool_calls != null) {
    badges.push({ key: 'tool_calls', label: `${summary.agent.tool_calls} ${t('calls')}`, tone: 'blue' });
  }
  return badges;
}

function normalizeWorkflowStageLabel(label: string): string {
  return label === 'Poetic diary rewrite' ? 'Diary' : label;
}

function workflowEventLabel(eventType: string): string {
  switch (eventType) {
    case 'run_started': return 'Run started';
    case 'phase_started': return 'Phase started';
    case 'phase_completed': return 'Phase completed';
    case 'llm_turn_started': return 'LLM turn';
    case 'tool_call_started': return 'Tool started';
    case 'tool_call_finished': return 'Tool finished';
    case 'protected_node_blocked': return 'Protected boot block';
    case 'policy_validation_blocked': return 'Policy validation block';
    case 'policy_warning_emitted': return 'Policy warning';
    case 'assistant_note': return 'Assistant note';
    case 'run_completed': return 'Run completed';
    case 'run_failed': return 'Run failed';
    default: return eventType.replace(/_/g, ' ');
  }
}

function workflowEventTone(eventType: string): 'green' | 'red' | 'orange' | 'blue' | 'default' {
  if (eventType === 'run_completed') return 'green';
  if (eventType === 'run_failed' || eventType === 'policy_validation_blocked') return 'red';
  if (eventType === 'protected_node_blocked' || eventType === 'policy_warning_emitted' || eventType === 'assistant_note') return 'orange';
  if (eventType === 'phase_completed' || eventType === 'tool_call_finished') return 'green';
  return 'blue';
}

type WorkflowStageRow = {
  key: string;
  label: string;
  tone: 'green' | 'red' | 'orange' | 'blue' | 'default';
  detail: string;
  conclusion: string;
  time: string | null;
  status: 'running' | 'completed';
};

function formatStageSummary(summary: unknown, t: (key: string) => string): string {
  if (!isRecord(summary)) return '';
  const fields: Array<[string, string]> = [
    ['turns', 'turns'],
    ['tool_calls', 'calls'],
    ['recall_queries', 'Recall queries'],
    ['metadata_queries', 'Metadata queries'],
    ['write_events', 'Write events'],
  ];
  return fields
    .flatMap(([key, label]) => {
      const value = summary[key];
      return typeof value === 'number' && value > 0 ? [`${t(label)} ${value}`] : [];
    })
    .join(' · ');
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstStringItems(value: unknown, limit = 2): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, limit)
    : [];
}

function objectArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.filter(isRecord).length : 0;
}

function formatStageConclusionFromNote(message: string, t: (key: string) => string): string {
  const note = parseJsonRecord(message);
  if (!note) return '';

  const parts: string[] = [];
  const recommendedFocus = typeof note.recommended_next_phase_focus === 'string' ? note.recommended_next_phase_focus : '';
  if (recommendedFocus) parts.push(`${t('Focus')}: ${recommendedFocus}`);

  const candidates = firstStringItems(note.high_confidence_next_candidates);
  if (candidates.length > 0) parts.push(candidates.join(' · '));

  const planCandidates = objectArrayLength(note.tree_maintenance_candidates);
  if (planCandidates > 0) parts.push(`${t('Candidates')} ${planCandidates}`);

  const recallRepairs = objectArrayLength(note.recall_repair_candidates);
  if (recallRepairs > 0) parts.push(`${t('Recall repairs')} ${recallRepairs}`);

  const validated = objectArrayLength(note.validated_candidates);
  if (validated > 0) parts.push(`${t('Validated')} ${validated}`);

  const recommendedApply = firstStringItems(note.recommended_apply);
  if (recommendedApply.length > 0) parts.push(`${t('Recommended apply')} ${recommendedApply.length}`);

  const appliedChanges = objectArrayLength(note.applied_changes);
  if (appliedChanges > 0) parts.push(`${t('Applied changes')} ${appliedChanges}`);

  const skipped = objectArrayLength(note.skipped);
  if (skipped > 0) parts.push(`${t('Skipped')} ${skipped}`);

  const changedNodes = objectArrayLength(note.changed_nodes);
  if (changedNodes > 0) parts.push(`${t('Changed nodes')} ${changedNodes}`);

  const confidence = typeof note.confidence === 'string' ? note.confidence : '';
  if (confidence) parts.push(`${t('Confidence')}: ${confidence}`);

  const expectedEffect = typeof note.expected_effect === 'string' ? note.expected_effect : '';
  if (expectedEffect) parts.push(expectedEffect);

  return parts.join(' · ');
}

function buildWorkflowStageRows(
  workflowEvents: DreamWorkflowEvent[],
  t: (key: string) => string,
): WorkflowStageRow[] {
  const rowsByPhase = new Map<string, WorkflowStageRow>();
  const conclusionsByPhase = new Map<string, string>();
  const phaseOrder: string[] = [];

  for (const event of workflowEvents) {
    if (event.event_type === 'assistant_note') {
      const message = typeof event.payload?.message === 'string' ? event.payload.message : '';
      const phase = typeof event.payload?.phase === 'string' ? event.payload.phase : '';
      const conclusion = formatStageConclusionFromNote(message, t);
      if (phase && conclusion) {
        conclusionsByPhase.set(phase, conclusion);
        const existing = rowsByPhase.get(phase);
        if (existing) rowsByPhase.set(phase, { ...existing, conclusion });
      }
      continue;
    }

    if (event.event_type !== 'phase_started' && event.event_type !== 'phase_completed') {
      continue;
    }
    const phase = typeof event.payload?.phase === 'string' ? event.payload.phase : '';
    const key = phase || `${event.id}`;
    if (!rowsByPhase.has(key)) {
      phaseOrder.push(key);
    }
    const existing = rowsByPhase.get(key);
    rowsByPhase.set(key, {
      key,
      label: normalizeWorkflowStageLabel(String(event.payload?.label || existing?.label || workflowEventLabel(event.event_type))),
      tone: workflowEventTone(event.event_type),
      detail: event.event_type === 'phase_completed' ? formatStageSummary(event.payload?.summary, t) : existing?.detail || '',
      conclusion: conclusionsByPhase.get(key) || existing?.conclusion || '',
      time: event.created_at || existing?.time || null,
      status: event.event_type === 'phase_completed' ? 'completed' : existing?.status || 'running',
    });
  }

  return phaseOrder.flatMap((key) => {
    const row = rowsByPhase.get(key);
    return row ? [row] : [];
  });
}

interface DreamDetailViewProps {
  entry: DreamEntry | null;
  loading: boolean;
  canRollback: boolean;
  rollingBack: boolean;
  reviewingChangeId?: number | null;
  onBack: () => void;
  onRollback: () => void;
  onReviewChange?: (changeId: number, status: 'approved' | 'dismissed') => void;
  onEditChange?: (uri: string) => void;
  t: (key: string) => string;
}

export function DreamDetailView({
  entry,
  loading,
  canRollback,
  rollingBack,
  reviewingChangeId = null,
  onBack,
  onRollback,
  onReviewChange,
  onEditChange,
  t,
}: DreamDetailViewProps): React.JSX.Element {
  const [showOriginalDiary, setShowOriginalDiary] = useState(false);
  const stats = useMemo(() => {
    const toolCalls = entry?.tool_calls || [];
    return {
      viewed: toolCalls.filter((call) => call.tool === 'get_node').length,
      modified: toolCalls.filter((call) => call.tool === 'update_node').length,
      created: toolCalls.filter((call) => call.tool === 'create_node').length,
      deleted: toolCalls.filter((call) => call.tool === 'delete_node').length,
    };
  }, [entry]);

  useEffect(() => {
    setShowOriginalDiary(false);
  }, [entry?.id]);

  if (loading || !entry) {
    return (
      <>
        <div className="mb-6">
          <Button variant="ghost" onClick={onBack}>← {t('Dream Diary')}</Button>
        </div>
        <div className="text-center py-12 text-txt-tertiary">{loading ? t('Loading…') : t('Not found')}</div>
      </>
    );
  }

  const rawNarrative = entry.raw_narrative || entry.narrative || '';
  const poeticNarrative = entry.poetic_narrative || entry.narrative || rawNarrative;
  const originalNarrative = formatOriginalDreamNarrativeForView(rawNarrative, t);
  const canToggleOriginalDiary = Boolean(rawNarrative && rawNarrative !== poeticNarrative);
  const displayedNarrative = showOriginalDiary ? originalNarrative : poeticNarrative;

  return (
    <>
      <div className="flex flex-col justify-between gap-3 mb-6 sm:flex-row sm:items-center">
        <Button variant="ghost" onClick={onBack}>← {t('Dream Diary')}</Button>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge className="min-w-[3.9rem] justify-center" tone={statusTone(entry.status)}>{t(entry.status)}</Badge>
          <span className="text-sm text-txt-tertiary">{fmtDate(entry.started_at)} · {fmtDuration(entry.duration_ms)}</span>
          {canRollback && (
            <Button variant="destructive" onClick={onRollback} disabled={rollingBack}>
              {rollingBack ? t('Rolling back…') : t('Rollback')}
            </Button>
          )}
        </div>
      </div>

      <div className="animate-in stagger-1 mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('Viewed')} value={stats.viewed} tone="blue" compact />
        <StatCard label={t('Modified')} value={stats.modified} tone="orange" compact />
        <StatCard label={t('Created')} value={stats.created} tone="green" compact />
        <StatCard label={t('Deleted')} value={stats.deleted} tone="red" compact />
      </div>

      {displayedNarrative && (
        <Section
          title={showOriginalDiary ? t('Original Diary') : t('Diary')}
          right={canToggleOriginalDiary ? (
            <Button
              variant="ghost"
              aria-pressed={showOriginalDiary}
              onClick={() => setShowOriginalDiary((current) => !current)}
            >
              {showOriginalDiary ? t('View diary') : t('View original diary')}
            </Button>
          ) : null}
          className="mb-5"
        >
          <div className="prose max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayedNarrative}</ReactMarkdown>
          </div>
        </Section>
      )}


      {(entry.status === 'running' || (entry.workflow_events && entry.workflow_events.length > 0)) && (
        <AgentWorkflowSection
          workflowEvents={entry.workflow_events || []}
          defaultExpanded={entry.status === 'running'}
          t={t}
        />
      )}

      {entry.memory_changes && entry.memory_changes.length > 0 && (
        <MemoryChangesSection
          changes={entry.memory_changes}
          reviewingChangeId={reviewingChangeId}
          onReviewChange={onReviewChange}
          onEditChange={onEditChange}
          t={t}
        />
      )}

      {entry.summary && (
        <Section title={t('Dream Summary')} className="mt-5">
          <div className="flex gap-2 flex-wrap">
            {getSummaryBadges(entry, t).map((badge) => (
              <Badge key={badge.key} tone={badge.tone}>{badge.label}</Badge>
            ))}
          </div>
        </Section>
      )}

      {entry.error && (
        <Notice tone="danger" className="mt-5">
          <span className="font-mono">{entry.error}</span>
        </Notice>
      )}
    </>
  );
}

interface AgentWorkflowSectionProps {
  workflowEvents: DreamWorkflowEvent[];
  defaultExpanded: boolean;
  t: (key: string) => string;
}

function AgentWorkflowSection({ workflowEvents, defaultExpanded, t }: AgentWorkflowSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rows = useMemo(() => buildWorkflowStageRows(workflowEvents, t), [workflowEvents, t]);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <Section
      title={t('Agent Stages')}
      subtitle={`${rows.length}`}
      right={
        <Button
          aria-label={expanded ? t('Collapse agent stages') : t('Expand agent stages')}
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
        >
          <span aria-hidden>{expanded ? '▲' : '▼'}</span>
        </Button>
      }
      className="mb-5"
    >
      {expanded && (
        rows.length > 0 ? (
          <div className="space-y-2 max-h-[360px] overflow-y-auto sm:max-h-[560px]">
            {rows.map((row) => (
              <div key={row.key} className="flex items-start gap-2 rounded-xl border border-separator-thin bg-bg-raised px-3 py-3">
                <Badge tone={row.tone}>{t(row.status)}</Badge>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-txt-primary">{t(row.label)}</div>
                  {row.detail && <div className="mt-0.5 truncate text-xs text-txt-tertiary">{row.detail}</div>}
                  {row.conclusion && <div className="mt-1 text-xs leading-relaxed text-txt-secondary">{row.conclusion}</div>}
                </div>
                <span className="shrink-0 text-xs text-txt-tertiary">{fmtDate(row.time)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-txt-tertiary">{t('Waiting for workflow events…')}</div>
        )
      )}
    </Section>
  );
}

interface MemoryChangesSectionProps {
  changes: MemoryChange[];
  reviewingChangeId: number | null;
  onReviewChange?: (changeId: number, status: 'approved' | 'dismissed') => void;
  onEditChange?: (uri: string) => void;
  t: (key: string) => string;
}

function MemoryChangesSection({ changes, reviewingChangeId, onReviewChange, onEditChange, t }: MemoryChangesSectionProps): React.JSX.Element {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <Section title={t('Memory Changes')} subtitle={`${changes.length}`} className="mb-5">
      <div className="space-y-2">
        {changes.map((change, index) => {
          const reviewStatus = change.review_status || 'pending';
          const changeId = Number(change.id || 0);
          const reviewing = changeId > 0 && reviewingChangeId === changeId;
          const editableUri = editableUriForChange(change);
          return (
            <div key={change.id || index} className="rounded-xl border border-separator-thin bg-bg-raised overflow-hidden">
              <div
                className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-fill-quaternary"
                onClick={() => setExpandedIdx(expandedIdx === index ? null : index)}
              >
                <Badge tone={changeTone(change.type)}>{t(change.type)}</Badge>
                <Badge tone={reviewStatusTone(reviewStatus)}>{t(reviewStatusLabel(reviewStatus))}</Badge>
                <code className="min-w-0 flex-1 truncate text-xs font-mono text-txt-primary">{change.uri}</code>
                {change.before?.priority !== undefined && change.after?.priority !== undefined && change.before.priority !== change.after.priority && (
                  <span className="text-xs text-txt-tertiary">P{change.before.priority}→P{change.after.priority}</span>
                )}
                {change.type === 'move' && change.before?.uri && change.after?.uri && (
                  <span className="hidden max-w-[16rem] truncate text-xs text-txt-tertiary sm:inline">{change.before.uri} → {change.after.uri}</span>
                )}
                <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  {changeId > 0 && onReviewChange && reviewStatus !== 'approved' && (
                    <Button size="sm" variant="ghost" onClick={() => onReviewChange(changeId, 'approved')} disabled={reviewing}>
                      {reviewing ? t('Saving…') : t('Approve')}
                    </Button>
                  )}
                  {changeId > 0 && onReviewChange && reviewStatus !== 'dismissed' && (
                    <Button size="sm" variant="ghost" onClick={() => onReviewChange(changeId, 'dismissed')} disabled={reviewing}>
                      {t('Dismiss')}
                    </Button>
                  )}
                  {editableUri && onEditChange && (
                    <Button size="sm" variant="ghost" onClick={() => onEditChange(editableUri)}>
                      {t('Edit')}
                    </Button>
                  )}
                  <span className="text-[11px] text-txt-quaternary">{expandedIdx === index ? '▲' : '▼'}</span>
                </div>
              </div>
            {expandedIdx === index && (
              <div className="space-y-2 border-t border-separator-thin px-3 py-3">
                {change.type === 'update' && change.before?.content !== undefined && change.after?.content !== undefined ? (
                  <DiffViewer oldText={change.before.content} newText={change.after.content} />
                ) : change.type === 'move' && change.before?.uri && change.after?.uri ? (
                  <div className="space-y-1 text-xs text-txt-tertiary">
                    <div>{t('Before')}: <code className="font-mono text-txt-primary">{change.before.uri}</code></div>
                    <div>{t('After')}: <code className="font-mono text-txt-primary">{change.after.uri}</code></div>
                  </div>
                ) : change.type === 'create' && change.after?.content ? (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-txt-tertiary">{t('After')}</div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs font-mono text-txt-secondary">{change.after.content}</pre>
                  </div>
                ) : change.type === 'delete' && change.before?.content ? (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-txt-tertiary">{t('Before')}</div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs font-mono text-txt-secondary line-through opacity-60">{change.before.content}</pre>
                  </div>
                ) : (
                  <div className="text-xs text-txt-tertiary">
                    {change.before && <div>{t('Before')}: {JSON.stringify(change.before)}</div>}
                    {change.after && <div>{t('After')}: {JSON.stringify(change.after)}</div>}
                  </div>
                )}
                {change.type === 'update' && change.before?.disclosure !== change.after?.disclosure && (
                  <div className="mt-1 text-xs text-txt-tertiary">
                    {t('Disclosure changed')}: <span className="line-through opacity-60">{change.before?.disclosure || t('(none)')}</span> → <span className="text-txt-primary">{change.after?.disclosure || t('(none)')}</span>
                  </div>
                )}
              </div>
            )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

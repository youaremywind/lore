import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DreamDetailView, formatOriginalDreamNarrativeForView } from '../DreamDetailView';
import type { DreamEntry } from '../useDreamPageController';

function entry(overrides: Partial<DreamEntry> = {}): DreamEntry {
  return {
    id: 1,
    status: 'completed',
    started_at: '2024-01-01T00:00:00Z',
    duration_ms: 1000,
    summary: {},
    narrative: 'Diary entry',
    raw_narrative: 'Raw audit diary',
    poetic_narrative: 'Diary entry',
    tool_calls: [],
    workflow_events: [],
    memory_changes: [],
    ...overrides,
  };
}

describe('DreamDetailView', () => {

  it('formats structured audit JSON into a readable original diary', () => {
    const audit = {
      primary_focus: 'recall_repair',
      changed_nodes: [{ uri: 'project://node', action: 'update_node', result: 'success', changes: ['补充 glossary'] }],
      evidence: [{ query_id: 'q1', reason: '召回缺少目标节点' }],
      why_not_more_changes: '证据只支持一次更新。',
      expected_effect: '后续召回更稳。',
      confidence: 'high',
    };

    const text = formatOriginalDreamNarrativeForView(JSON.stringify(audit), (key) => key);

    expect(text).toContain('Primary focus: recall_repair');
    expect(text).toContain('project://node');
    expect(text).toContain('补充 glossary');
    expect(text).toContain('召回缺少目标节点');
    expect(text).not.toContain('{');
  });

  it('shows the diary with an original diary toggle and no audit card', () => {
    const audit = {
      primary_focus: 'tree_maintenance',
      changed_nodes: [
        {
          uri: 'project://lore_integration/dream_system/dream_prompt_workflow_review',
          action: 'update_node',
          result: 'success',
          changes: ['absorbed新版 Dream 三层优先级', 'narrowed disclosure'],
        },
      ],
      evidence: [
        {
          query_id: '61a648e8-1c28-48b7-b767-8890c71bbd00',
          reason: '用户明确给出新版 Dream 定义与三层优先级。',
        },
      ],
      why_not_more_changes: '今日候选均可归入既有节点。',
      expected_effect: '后续查询新版 Dream 定义时更稳定命中。',
      confidence: 'high',
    };
    const html = renderToStaticMarkup(
      <DreamDetailView
        entry={entry({ raw_narrative: JSON.stringify(audit), poetic_narrative: 'Diary entry' })}
        loading={false}
        canRollback={false}
        rollingBack={false}
        onBack={() => undefined}
        onRollback={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('Diary');
    expect(html).toContain('Diary entry');
    expect(html).toContain('View original diary');
    expect(html).not.toContain('Raw audit diary');
    expect(html).not.toContain('Original Diary');
    expect(html).not.toContain('Dream Audit');
    expect(html).not.toContain('tree_maintenance');
    expect(html).not.toContain('project://lore_integration/dream_system/dream_prompt_workflow_review');
    expect(html).not.toContain('absorbed新版 Dream 三层优先级');
  });

  it('shows final memory changes without rendering the audit card', () => {
    const audit = {
      primary_focus: 'tree_maintenance',
      changed_nodes: [
        {
          uri: 'project://lore_integration/dream_system/dream_prompt_workflow_review',
          action: 'update_node',
          result: 'success',
          changes: ['audit duplicate summary'],
        },
      ],
      expected_effect: 'future recall improves',
      confidence: 'high',
    };

    const html = renderToStaticMarkup(
      <DreamDetailView
        entry={entry({
          raw_narrative: JSON.stringify(audit),
          memory_changes: [
            {
              id: 22,
              type: 'update',
              uri: 'project://lore_integration/dream_system/dream_prompt_workflow_review',
              before: { content: 'before' },
              after: { content: 'after' },
              review_status: 'pending',
            },
          ],
        })}
        loading={false}
        canRollback={false}
        rollingBack={false}
        onBack={() => undefined}
        onRollback={() => undefined}
        onReviewChange={() => undefined}
        onEditChange={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).not.toContain('Dream Audit');
    expect(html).toContain('Memory Changes');
    expect(html).toContain('Pending review');
    expect(html).toContain('Approve');
    expect(html).toContain('Dismiss');
    expect(html).toContain('Edit');
    expect(html).not.toContain('audit duplicate summary');
    expect(html).not.toContain('Changed nodes');
    const uri = 'project://lore_integration/dream_system/dream_prompt_workflow_review';
    expect(html.split(uri).length - 1).toBe(1);
  });



  it('shows only the four key stat cards', () => {
    const html = renderToStaticMarkup(
      <DreamDetailView
        entry={entry({
          tool_calls: [
            { tool: 'get_node' },
            { tool: 'update_node' },
            { tool: 'create_node' },
            { tool: 'delete_node' },
          ] as DreamEntry['tool_calls'],
          memory_changes: [{ type: 'move', uri: 'project://old', before: {}, after: {} }],
          workflow_events: [
            { id: 1, diary_id: 1, event_type: 'protected_node_blocked', payload: {}, created_at: '2024-01-01T00:00:00Z' },
            { id: 2, diary_id: 1, event_type: 'policy_validation_blocked', payload: {}, created_at: '2024-01-01T00:00:00Z' },
            { id: 3, diary_id: 1, event_type: 'policy_warning_emitted', payload: {}, created_at: '2024-01-01T00:00:00Z' },
          ],
        })}
        loading={false}
        canRollback={false}
        rollingBack={false}
        onBack={() => undefined}
        onRollback={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('Viewed');
    expect(html).toContain('Modified');
    expect(html).toContain('Created');
    expect(html).toContain('Deleted');
    expect(html).not.toContain('Moved');
    expect(html).not.toContain('Protected');
    expect(html).not.toContain('Policy blocks');
    expect(html).not.toContain('Policy warnings');
  });

  it('collapses completed agent stages by default', () => {
    const html = renderToStaticMarkup(
      <DreamDetailView
        entry={entry({
          status: 'completed',
          workflow_events: [
            {
              id: 1,
              diary_id: 1,
              event_type: 'phase_started',
              payload: { phase: 'diagnose', label: 'Read-only diagnosis' },
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 2,
              diary_id: 1,
              event_type: 'phase_completed',
              payload: { phase: 'diagnose', label: 'Read-only diagnosis', summary: { turns: 1, tool_calls: 1 } },
              created_at: '2024-01-01T00:00:04Z',
            },
          ],
        })}
        loading={false}
        canRollback={false}
        rollingBack={false}
        onBack={() => undefined}
        onRollback={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('Agent Stages');
    expect(html).toContain('Expand agent stages');
    expect(html).not.toContain('Read-only diagnosis');
  });

  it('normalizes legacy poetic stage labels to diary on the page', () => {
    const html = renderToStaticMarkup(
      <DreamDetailView
        entry={entry({
          workflow_events: [
            {
              id: 1,
              diary_id: 1,
              event_type: 'phase_started',
              payload: { phase: 'poetic_rewrite', label: 'Poetic diary rewrite' },
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 2,
              diary_id: 1,
              event_type: 'phase_completed',
              payload: { phase: 'poetic_rewrite', label: 'Poetic diary rewrite', summary: {} },
              created_at: '2024-01-01T00:00:01Z',
            },
          ],
        })}
        loading={false}
        canRollback={false}
        rollingBack={false}
        onBack={() => undefined}
        onRollback={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('Diary');
    expect(html).not.toContain('Poetic diary rewrite');
  });

  it('shows agent stages without detailed tool workflow events', () => {
    const html = renderToStaticMarkup(
      <DreamDetailView
        entry={entry({
          status: 'running',
          workflow_events: [
            {
              id: 1,
              diary_id: 1,
              event_type: 'phase_started',
              payload: { phase: 'diagnose', label: 'Read-only diagnosis' },
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 2,
              diary_id: 1,
              event_type: 'tool_call_started',
              payload: { tool: 'get_node', turn: 1 },
              created_at: '2024-01-01T00:00:01Z',
            },
            {
              id: 3,
              diary_id: 1,
              event_type: 'tool_call_finished',
              payload: { tool: 'get_node', turn: 1, ok: true },
              created_at: '2024-01-01T00:00:02Z',
            },
            {
              id: 4,
              diary_id: 1,
              event_type: 'assistant_note',
              payload: { message: 'verbose diagnostic note' },
              created_at: '2024-01-01T00:00:03Z',
            },
            {
              id: 5,
              diary_id: 1,
              event_type: 'phase_completed',
              payload: { phase: 'diagnose', label: 'Read-only diagnosis', summary: { turns: 1, tool_calls: 1 } },
              created_at: '2024-01-01T00:00:04Z',
            },
          ],
        })}
        loading={false}
        canRollback={false}
        rollingBack={false}
        onBack={() => undefined}
        onRollback={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('Agent Stages');
    expect(html).toContain('Read-only diagnosis');
    expect(html).not.toContain('Agent Workflow');
    expect(html).not.toContain('get_node');
    expect(html).not.toContain('verbose diagnostic note');
  });

  it('shows derived stage conclusions from structured assistant notes', () => {
    const html = renderToStaticMarkup(
      <DreamDetailView
        entry={entry({
          status: 'running',
          workflow_events: [
            {
              id: 1,
              diary_id: 1,
              event_type: 'phase_started',
              payload: { phase: 'diagnose', label: 'Read-only diagnosis' },
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 2,
              diary_id: 1,
              event_type: 'assistant_note',
              payload: {
                phase: 'diagnose',
                message: JSON.stringify({
                  recommended_next_phase_focus: 'tree_maintenance',
                  high_confidence_next_candidates: ['更新 workflow review 节点', '更新 diary prompt 节点'],
                }),
              },
              created_at: '2024-01-01T00:00:03Z',
            },
            {
              id: 3,
              diary_id: 1,
              event_type: 'phase_completed',
              payload: { phase: 'diagnose', label: 'Read-only diagnosis', summary: { turns: 1, tool_calls: 1 } },
              created_at: '2024-01-01T00:00:04Z',
            },
          ],
        })}
        loading={false}
        canRollback={false}
        rollingBack={false}
        onBack={() => undefined}
        onRollback={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('tree_maintenance');
    expect(html).toContain('更新 workflow review 节点');
    expect(html).toContain('calls 1');
  });
});

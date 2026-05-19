import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../server/auth', () => ({
  requireBearerAuth: vi.fn(),
  normalizeClientType: vi.fn((value: string | null) => value || 'unknown'),
}));
vi.mock('../../../../server/lore/memory/browse', () => ({
  getNodePayload: vi.fn(),
  listDomains: vi.fn(),
}));
vi.mock('../../../../server/lore/memory/write', () => ({
  createNode: vi.fn(),
  updateNodeByPath: vi.fn(),
  deleteNodeByPath: vi.fn(),
  moveNode: vi.fn(),
}));
vi.mock('../../../../server/lore/memory/history', () => ({
  getNodeHistory: vi.fn(),
  rollbackNodeToEvent: vi.fn(),
}));
vi.mock('../../../../server/lore/ops/policy', () => ({
  validateCreatePolicy: vi.fn(),
  validateUpdatePolicy: vi.fn(),
  validateDeletePolicy: vi.fn(),
}));
vi.mock('../../../../server/lore/search/search', () => ({
  searchMemories: vi.fn(),
}));
vi.mock('../../../../server/lore/search/glossary', () => ({
  getGlossary: vi.fn(),
  addGlossaryKeyword: vi.fn(),
  removeGlossaryKeyword: vi.fn(),
}));

import { normalizeClientType, requireBearerAuth } from '../../../../server/auth';
import { getNodePayload, listDomains } from '../../../../server/lore/memory/browse';
import { getNodeHistory, rollbackNodeToEvent } from '../../../../server/lore/memory/history';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from '../../../../server/lore/memory/write';
import { validateCreatePolicy, validateUpdatePolicy, validateDeletePolicy } from '../../../../server/lore/ops/policy';
import { searchMemories } from '../../../../server/lore/search/search';
import { addGlossaryKeyword, getGlossary, removeGlossaryKeyword } from '../../../../server/lore/search/glossary';
import * as nodeRoute from '../node/route';
import * as searchRoute from '../search/route';
import * as domainsRoute from '../domains/route';
import * as moveRoute from '../move/route';
import * as glossaryRoute from '../glossary/route';
import * as historyRoute from '../history/route';
import * as recallRoute from '../recall/route';
import * as recallStatsRoute from '../recall/stats/route';
import * as recallUsageRoute from '../recall/usage/route';

vi.mock('../../../../server/lore/recall/recall', () => ({
  recallMemories: vi.fn(),
  getRecallRuntimeConfig: vi.fn(),
  loadRecallSafetyConfig: vi.fn(),
}));
vi.mock('../../../../server/lore/recall/recallAnalytics', () => ({
  getRecallStats: vi.fn(),
}));
vi.mock('../../../../server/lore/recall/recallEventLog', () => ({
  markRecallEventsUsedInAnswer: vi.fn(),
}));

import { getRecallRuntimeConfig, loadRecallSafetyConfig, recallMemories } from '../../../../server/lore/recall/recall';
import { getRecallStats } from '../../../../server/lore/recall/recallAnalytics';
import { markRecallEventsUsedInAnswer } from '../../../../server/lore/recall/recallEventLog';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockNormalizeClientType = vi.mocked(normalizeClientType);
const mockGetNodePayload = vi.mocked(getNodePayload);
const mockGetNodeHistory = vi.mocked(getNodeHistory);
const mockRollbackNodeToEvent = vi.mocked(rollbackNodeToEvent);
const mockListDomains = vi.mocked(listDomains);
const mockCreateNode = vi.mocked(createNode);
const mockUpdateNodeByPath = vi.mocked(updateNodeByPath);
const mockDeleteNodeByPath = vi.mocked(deleteNodeByPath);
const mockMoveNode = vi.mocked(moveNode);
const mockValidateCreatePolicy = vi.mocked(validateCreatePolicy);
const mockValidateUpdatePolicy = vi.mocked(validateUpdatePolicy);
const mockValidateDeletePolicy = vi.mocked(validateDeletePolicy);
const mockSearchMemories = vi.mocked(searchMemories);
const mockGetGlossary = vi.mocked(getGlossary);
const mockAddGlossaryKeyword = vi.mocked(addGlossaryKeyword);
const mockRemoveGlossaryKeyword = vi.mocked(removeGlossaryKeyword);
const mockRecallMemories = vi.mocked(recallMemories);
const mockGetRecallRuntimeConfig = vi.mocked(getRecallRuntimeConfig);
const mockLoadRecallSafetyConfig = vi.mocked(loadRecallSafetyConfig);
const mockGetRecallStats = vi.mocked(getRecallStats);
const mockMarkRecallEventsUsedInAnswer = vi.mocked(markRecallEventsUsedInAnswer);

describe('browse route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBearerAuth.mockReturnValue(null);
    mockNormalizeClientType.mockImplementation((value: string | null) => value || 'unknown');
    mockValidateCreatePolicy.mockResolvedValue({ errors: [], warnings: [] } as any);
    mockValidateUpdatePolicy.mockResolvedValue({ errors: [], warnings: [] } as any);
    mockValidateDeletePolicy.mockResolvedValue({ errors: [], warnings: [] } as any);
    mockGetRecallRuntimeConfig.mockResolvedValue({} as any);
    mockLoadRecallSafetyConfig.mockResolvedValue({ max_query_chars: 200, timeout_ms: 2000 } as any);
  });

  it('adds canonical and legacy warning envelopes to create validation failures', async () => {
    mockValidateCreatePolicy.mockResolvedValueOnce({
      errors: ['priority is required'],
      warnings: ['disclosure is recommended'],
    } as any);

    const response = await nodeRoute.POST(new Request('http://localhost/api/browse/node', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'core', content: 'hello', priority: 3 }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('priority is required');
    expect(body.code).toBe('validation_error');
    expect(body.warnings).toEqual(['disclosure is recommended']);
    expect(body.policy_warnings).toEqual(['disclosure is recommended']);
  });

  it('adds legacy node compatibility to create success payloads', async () => {
    mockCreateNode.mockResolvedValueOnce({
      success: true,
      operation: 'create',
      uri: 'core://agent/profile',
      path: 'agent/profile',
      node_uuid: 'uuid-create',
    } as any);

    const response = await nodeRoute.POST(new Request('http://localhost/api/browse/node?client_type=hermes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'core', parent_path: 'agent', title: 'profile', content: 'hello', priority: 2 }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.operation).toBe('create');
    expect(body.uri).toBe('core://agent/profile');
    expect(body.node_uuid).toBe('uuid-create');
    expect(body.node).toEqual({ uri: 'core://agent/profile', node_uuid: 'uuid-create', content: 'hello' });
    expect(body.warnings).toEqual([]);
    expect(body.policy_warnings).toEqual([]);
  });

  it('adds legacy node compatibility to update success payloads', async () => {
    mockUpdateNodeByPath.mockResolvedValueOnce({
      success: true,
      operation: 'update',
      uri: 'core://agent/profile',
      path: 'agent/profile',
      node_uuid: 'uuid-update',
    } as any);

    const response = await nodeRoute.PUT(new Request('http://localhost/api/browse/node?domain=core&path=agent/profile&client_type=claudecode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'updated', session_id: 'session-1' }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.operation).toBe('update');
    expect(body.node).toEqual({ uri: 'core://agent/profile', node_uuid: 'uuid-update' });
    expect(body.warnings).toEqual([]);
    expect(body.policy_warnings).toEqual([]);
  });

  it('returns canonical delete receipts with warnings envelopes', async () => {
    mockValidateDeletePolicy.mockResolvedValueOnce({ errors: [], warnings: ['delete warning'] } as any);
    mockDeleteNodeByPath.mockResolvedValueOnce({
      success: true,
      operation: 'delete',
      uri: 'core://agent/profile',
      path: 'agent/profile',
      node_uuid: 'uuid-delete',
      deleted_uri: 'core://agent/profile',
    } as any);

    const response = await nodeRoute.DELETE(new Request('http://localhost/api/browse/node?domain=core&path=agent/profile&session_id=s1', {
      method: 'DELETE',
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.operation).toBe('delete');
    expect(body.deleted_uri).toBe('core://agent/profile');
    expect(body.warnings).toEqual(['delete warning']);
    expect(body.policy_warnings).toEqual(['delete warning']);
  });

  it('returns canonical error codes from node GET', async () => {
    mockGetNodePayload.mockRejectedValueOnce(Object.assign(new Error('Missing node'), { status: 404 }));

    const response = await nodeRoute.GET(new Request('http://localhost/api/browse/node?domain=core&path=missing') as any);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.detail).toBe('Missing node');
    expect(body.code).toBe('not_found');
  });

  it('returns canonical error codes from search GET', async () => {
    mockSearchMemories.mockRejectedValueOnce(Object.assign(new Error('Search rejected'), { status: 422 }));

    const response = await searchRoute.GET(new Request('http://localhost/api/browse/search?q=test') as any);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('Search rejected');
    expect(body.code).toBe('validation_error');
  });

  it('returns canonical error codes from domains GET', async () => {
    mockListDomains.mockRejectedValueOnce(Object.assign(new Error('Collision'), { status: 409 }));

    const response = await domainsRoute.GET(new Request('http://localhost/api/browse/domains') as any);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.detail).toBe('Collision');
    expect(body.code).toBe('conflict');
  });

  it('returns canonical move receipts and errors', async () => {
    mockMoveNode.mockResolvedValueOnce({
      success: true,
      operation: 'move',
      uri: 'core://new/path',
      path: 'new/path',
      node_uuid: 'uuid-move',
      old_uri: 'core://old/path',
      new_uri: 'core://new/path',
    } as any);

    const okRequest = new Request('http://localhost/api/browse/move?client_type=admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ old_uri: 'core://old/path', new_uri: 'core://new/path' }),
    }) as any;
    okRequest.nextUrl = new URL(okRequest.url);
    const okResponse = await moveRoute.POST(okRequest);
    const okBody = await okResponse.json();
    expect(okBody.operation).toBe('move');
    expect(okBody.uri).toBe('core://new/path');

    mockMoveNode.mockRejectedValueOnce(Object.assign(new Error('Target path already exists'), { status: 409 }));
    const badRequest = new Request('http://localhost/api/browse/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ old_uri: 'core://old/path', new_uri: 'core://new/path' }),
    }) as any;
    badRequest.nextUrl = new URL(badRequest.url);
    const badResponse = await moveRoute.POST(badRequest);
    const badBody = await badResponse.json();
    expect(badResponse.status).toBe(409);
    expect(badBody.code).toBe('conflict');
  });

  it('returns canonical glossary and annex route errors', async () => {
    mockGetGlossary.mockRejectedValueOnce(Object.assign(new Error('Glossary failed'), { status: 422 }));
    const glossaryResponse = await glossaryRoute.GET(new Request('http://localhost/api/browse/glossary') as any);
    const glossaryBody = await glossaryResponse.json();
    expect(glossaryResponse.status).toBe(422);
    expect(glossaryBody.code).toBe('validation_error');

    mockRecallMemories.mockRejectedValueOnce(Object.assign(new Error('Recall failed hard'), { status: 409 }));
    const recallRequest = new Request('http://localhost/api/browse/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x' }),
    }) as any;
    recallRequest.nextUrl = new URL(recallRequest.url);
    const recallResponse = await recallRoute.POST(recallRequest);
    const recallBody = await recallResponse.json();
    expect(recallResponse.status).toBe(409);
    expect(recallBody.code).toBe('conflict');


    mockMarkRecallEventsUsedInAnswer.mockRejectedValueOnce(Object.assign(new Error('Bad recall usage'), { status: 422 }));
    const usageResponse = await recallUsageRoute.POST(new Request('http://localhost/api/browse/recall/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query_id: 'q1' }),
    }) as any);
    const usageBody = await usageResponse.json();
    expect(usageResponse.status).toBe(422);
    expect(usageBody.code).toBe('validation_error');
  });

  it('adds an English recall notice when the query was truncated', async () => {
    mockRecallMemories.mockResolvedValueOnce({
      items: [],
      retrieval_meta: {
        query_truncated: true,
        query_char_limit: 200,
      },
    } as any);

    const request = new Request('http://localhost/api/browse/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x'.repeat(250) }),
    }) as any;
    request.nextUrl = new URL(request.url);

    const response = await recallRoute.POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({
      uri: 'notice://recall/query_truncated',
      cues: [expect.stringContaining('User content is too long')],
    });
    expect(body.items[0].cues[0]).toContain('first 200 characters');
    expect(body.items[0].cues[0]).toContain('lore_search');
  });

  it('returns an English notice-only payload when recall times out', async () => {
    vi.useFakeTimers();
    try {
      mockRecallMemories.mockImplementationOnce(() => new Promise(() => {}) as any);

      const request = new Request('http://localhost/api/browse/recall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'slow' }),
      }) as any;
      request.nextUrl = new URL(request.url);

      const responsePromise = recallRoute.POST(request);
      await vi.advanceTimersByTimeAsync(2001);
      const response = await responsePromise;
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items[0]).toMatchObject({
        uri: 'notice://recall/timeout',
        cues: [expect.stringContaining('Recall took longer than 2 seconds')],
      });
      expect(body.items[0].cues[0]).toContain('lore_search');
      expect(body.items).toHaveLength(1);
      expect(body.retrieval_meta).toMatchObject({ recall_timed_out: true, timeout_ms: 2000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns both truncation and timeout notices when an overlong recall times out', async () => {
    vi.useFakeTimers();
    try {
      mockRecallMemories.mockImplementationOnce(() => new Promise(() => {}) as any);

      const request = new Request('http://localhost/api/browse/recall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'x'.repeat(250) }),
      }) as any;
      request.nextUrl = new URL(request.url);

      const responsePromise = recallRoute.POST(request);
      await vi.advanceTimersByTimeAsync(2001);
      const response = await responsePromise;
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items.map((item: Record<string, unknown>) => item.uri)).toEqual([
        'notice://recall/query_truncated',
        'notice://recall/timeout',
      ]);
      expect(body.items[0].cues[0]).toContain('first 200 characters');
      expect(body.items[1].cues[0]).toContain('Recall took longer than 2 seconds');
      expect(body.retrieval_meta).toMatchObject({
        query_truncated: true,
        query_char_limit: 200,
        recall_timed_out: true,
        timeout_ms: 2000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses configured recall timeout from settings', async () => {
    vi.useFakeTimers();
    try {
      mockLoadRecallSafetyConfig.mockResolvedValueOnce({ max_query_chars: 200, timeout_ms: 3000 } as any);
      mockRecallMemories.mockImplementationOnce(() => new Promise(() => {}) as any);

      const request = new Request('http://localhost/api/browse/recall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'slow' }),
      }) as any;
      request.nextUrl = new URL(request.url);

      const responsePromise = recallRoute.POST(request);
      await vi.advanceTimersByTimeAsync(2001);
      const early = await Promise.race([
        responsePromise.then(() => 'resolved'),
        Promise.resolve('pending'),
      ]);
      expect(early).toBe('pending');

      await vi.advanceTimersByTimeAsync(1000);
      const response = await responsePromise;
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items[0]).toMatchObject({
        uri: 'notice://recall/timeout',
        cues: [expect.stringContaining('Recall took longer than 3 seconds')],
      });
      expect(body.retrieval_meta).toMatchObject({ recall_timed_out: true, timeout_ms: 3000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads recall stats without dormant nodeUri plumbing', async () => {
    mockGetRecallStats.mockResolvedValueOnce({ summary: { query_count: 0 } } as any);
    mockGetRecallRuntimeConfig.mockResolvedValueOnce({ display: { min_score: 0.5 } } as any);

    const response = await recallStatsRoute.GET(new Request('http://localhost/api/browse/recall/stats?days=3&query_id=q1&node_uri=core://ignored&client_type=codex') as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({ query_count: 0 });
    expect(mockGetRecallStats).toHaveBeenCalledWith(expect.objectContaining({
      days: 3,
      queryId: 'q1',
      clientType: 'codex',
    }));
    expect(mockGetRecallStats).toHaveBeenCalledWith(expect.not.objectContaining({
      nodeUri: expect.anything(),
    }));
  });

  it('loads node history with domain path and limit', async () => {
    const payload = { events: [{ event_id: 12, operation: 'update' }], next_cursor: null };
    mockGetNodeHistory.mockResolvedValueOnce(payload as any);

    const response = await historyRoute.GET(new Request('http://localhost/api/browse/history?domain=core&path=agent/profile&limit=25') as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetNodeHistory).toHaveBeenCalledWith({ domain: 'core', path: 'agent/profile', limit: 25 });
    expect(body).toEqual(payload);
  });

  it('rolls back node history events with provenance', async () => {
    const receipt = { success: true, operation: 'rollback', uri: 'core://agent/profile' };
    mockRollbackNodeToEvent.mockResolvedValueOnce(receipt as any);

    const response = await historyRoute.POST(new Request('http://localhost/api/browse/history?domain=core&path=agent/profile&client_type=claudecode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_id: 12, session_id: 'session-1' }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRollbackNodeToEvent).toHaveBeenCalledWith(
      { domain: 'core', path: 'agent/profile', eventId: 12 },
      { source: 'api:POST /browse/history', session_id: 'session-1', client_type: 'claudecode' },
    );
    expect(body).toEqual(receipt);
  });

  it('returns canonical validation errors from history rollback', async () => {
    mockRollbackNodeToEvent.mockRejectedValueOnce(Object.assign(new Error('Cannot rollback deleted node'), { status: 422 }));

    const response = await historyRoute.POST(new Request('http://localhost/api/browse/history?domain=core&path=agent/profile&client_type=claudecode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_id: 12, session_id: 'session-1' }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('Cannot rollback deleted node');
    expect(body.code).toBe('validation_error');
  });
});

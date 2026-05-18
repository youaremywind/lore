import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../server/auth', () => ({
  requireBearerAuth: vi.fn(),
  normalizeClientType: vi.fn((value: string | null) => value || null),
}));
vi.mock('../../../../server/lore/memory/boot', () => ({
  bootView: vi.fn(),
}));
vi.mock('../../../../server/lore/recall/recall', () => ({
  recallMemories: vi.fn(),
  loadRecallSafetyConfig: vi.fn(),
}));

import { normalizeClientType, requireBearerAuth } from '../../../../server/auth';
import { bootView } from '../../../../server/lore/memory/boot';
import { loadRecallSafetyConfig, recallMemories } from '../../../../server/lore/recall/recall';
import * as startupRoute from '../startup/route';
import * as recallRoute from '../recall/route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockNormalizeClientType = vi.mocked(normalizeClientType);
const mockBootView = vi.mocked(bootView);
const mockRecallMemories = vi.mocked(recallMemories);
const mockLoadRecallSafetyConfig = vi.mocked(loadRecallSafetyConfig);

describe('bridge route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBearerAuth.mockReturnValue(null);
    mockNormalizeClientType.mockImplementation((value: string | null) => (value || null) as any);
    mockLoadRecallSafetyConfig.mockResolvedValue({ max_query_chars: 200, timeout_ms: 2000 } as any);
    mockBootView.mockResolvedValue({
      loaded: 4,
      total: 4,
      failed: [],
      core_memories: [
        { uri: 'core://agent', content: 'Agent rules', priority: 1, boot_role_label: 'workflow constraints' },
        { uri: 'core://agent/codex', content: 'Codex rules', priority: 0, boot_role_label: 'codex runtime constraints', scope: 'client', client_type: 'codex' },
      ],
      recent_memories: [],
    } as any);
    mockRecallMemories.mockResolvedValue({
      items: [{ uri: 'project://lore', score_display: 0.82, cues: ['bridge'] }],
      event_log: { query_id: 'q-start' },
    } as any);
  });

  it('builds startup context from boot, guidance, and startup recall queries', async () => {
    const request = new Request('http://localhost/api/bridge/startup?client_type=codex', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: 'sess-1',
        channel: 'codex',
        include_guidance: true,
        project: { dir_name: 'lore', repo_name: 'lore' },
      }),
    }) as any;

    const response = await startupRoute.POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.guidance).toContain('Lore');
    expect(body.boot_context).toContain('## lore_boot 已加载内容');
    expect(body.boot_context).toContain('core://agent/codex');
    expect(body.startup_recall_context).toContain('<recall session_id="boot" query_id="q-start">');
    expect(body.system_context).toContain(body.guidance);
    expect(body.system_context).toContain(body.boot_context);
    expect(body.system_context).toContain(body.startup_recall_context);
    expect(body.meta).toMatchObject({ client_type: 'codex', session_id: 'sess-1', channel: 'codex', queries: ['codex', 'lore'] });
    expect(mockBootView).toHaveBeenCalledWith({ client_type: 'codex' });
    expect(mockRecallMemories).toHaveBeenCalledWith(expect.objectContaining({ query: 'codex', session_id: 'boot' }), { clientType: 'codex' });
    expect(mockRecallMemories).toHaveBeenCalledWith(expect.objectContaining({ query: 'lore', session_id: 'boot' }), { clientType: 'codex' });
  });

  it('builds prompt recall context with query id and node uris', async () => {
    mockRecallMemories.mockResolvedValueOnce({
      items: [{ uri: 'core://agent', score_display: 0.8, cues: ['agent'] }],
      event_log: { query_id: 'q-prompt' },
    } as any);

    const request = new Request('http://localhost/api/bridge/recall?client_type=openclaw', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'sess-1', prompt: 'remember agent rules' }),
    }) as any;

    const response = await recallRoute.POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.context).toContain('<recall session_id="sess-1" query_id="q-prompt">');
    expect(body.context).toContain('0.80 | core://agent | agent');
    expect(body.context).not.toContain('read ·');
    expect(body.query_id).toBe('q-prompt');
    expect(body.node_uris).toEqual(['core://agent']);
    expect(body.has_recall).toBe(true);
    expect(mockRecallMemories).toHaveBeenCalledWith(expect.objectContaining({ query: 'remember agent rules', session_id: 'sess-1' }), { clientType: 'openclaw' });
  });

  it('returns empty prompt recall context when no prompt or recall exists', async () => {
    const request = new Request('http://localhost/api/bridge/recall?client_type=pi', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'sess-empty', prompt: '' }),
    }) as any;

    const response = await recallRoute.POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ context: '', query_id: '', node_uris: [], has_recall: false });
    expect(mockRecallMemories).not.toHaveBeenCalled();
  });

});

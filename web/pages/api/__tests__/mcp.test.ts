import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnect = vi.fn();
const mockHandleRequest = vi.fn();
const mockTransportConstructor = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn(function MockStreamableHTTPServerTransport(options) {
    mockTransportConstructor(options);
    return {
      handleRequest: mockHandleRequest,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', async () => {
  const actual = await vi.importActual<typeof import('@modelcontextprotocol/sdk/types.js')>('@modelcontextprotocol/sdk/types.js');
  return actual;
});

vi.mock('../../../server/mcpServer', () => ({
  createMcpServer: vi.fn(() => ({
    connect: mockConnect,
  })),
}));

vi.mock('../../../server/auth', async () => {
  const actual = await vi.importActual<typeof import('../../../server/auth')>('../../../server/auth');
  return actual;
});

import handler from '../mcp';

function makeReq({ method = 'POST', sessionId, body }: { method?: string; sessionId?: string; body?: unknown }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as any;
  req.method = method;
  req.query = { client_type: 'codex' };
  req.headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
  };
  return req;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    headersSent: false,
    body: undefined,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      res.headersSent = true;
      return res;
    }),
    send: vi.fn((body?: unknown) => {
      res.body = body;
      res.headersSent = true;
      return res;
    }),
    setHeader: vi.fn(),
    end: vi.fn((body?: unknown) => {
      res.body = body;
      res.headersSent = true;
      return res;
    }),
  };
  return res;
}

describe('/api/mcp stateless transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleRequest.mockImplementation(async (_req, res, body) => {
      res.status(200).json({ ok: true, body });
    });
  });

  it('accepts a tool request carrying a stale mcp-session-id after backend restart', async () => {
    const req = makeReq({
      sessionId: 'stale-session-id',
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    expect(mockTransportConstructor).toHaveBeenCalledWith({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockHandleRequest).toHaveBeenCalledWith(
      req,
      res,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    );
  });
});

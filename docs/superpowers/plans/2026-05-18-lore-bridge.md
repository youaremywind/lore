# Lore Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Lore startup, recall, and session-end lifecycle logic into backend bridge endpoints so runtime plugins become thin adapters.

**Architecture:** Add `web/server/lore/bridge/*` service functions and `/api/bridge/*` routes that return already-formatted context blocks. Migrate Claude Code, Codex, Pi, OpenClaw, and Hermes to call bridge endpoints while preserving each runtime's output shape. Keep direct memory tools on existing browse/MCP APIs; bridge v1 covers lifecycle context only.

**Tech Stack:** Next.js route handlers, strict TypeScript, Vitest, Node hook scripts, Pi/OpenClaw TypeScript plugins, Hermes Python memory provider, unittest.

---

## File Structure

- Create `web/server/lore/bridge/format.ts` — shared formatters for boot sections, recall blocks, startup recall sections, and project query construction.
- Create `web/server/lore/bridge/startup.ts` — bridge startup service: boot view + startup recall blocks + combined context.
- Create `web/server/lore/bridge/recall.ts` — bridge prompt recall service: recallMemories + formatted `<recall>` context.
- Create `web/server/lore/bridge/session.ts` — bridge session cleanup service.
- Create `web/app/api/bridge/startup/route.ts` — authenticated startup bridge endpoint.
- Create `web/app/api/bridge/recall/route.ts` — authenticated recall bridge endpoint.
- Create `web/app/api/bridge/session/end/route.ts` — authenticated session-end bridge endpoint.
- Create `web/app/api/bridge/__tests__/route.test.ts` — route/service contract tests.
- Modify `claudecode-plugin/hooks/rules-inject.ts` — call `/api/bridge/startup` and output Claude SessionStart JSON.
- Modify `claudecode-plugin/hooks/recall-inject.ts` — call `/api/bridge/recall` and output context text.
- Modify `codex-plugin/hooks/rules-inject.ts` — call `/api/bridge/startup`, prepend local static guidance, output Codex SessionStart JSON.
- Modify `codex-plugin/hooks/recall-inject.ts` — call `/api/bridge/recall` and output Codex UserPromptSubmit JSON.
- Modify `pi-extension/hooks.ts` — call bridge startup/recall/session-end endpoints; keep Pi output mapping.
- Modify `openclaw-plugin/hooks.ts` — call bridge startup/recall/session-end endpoints; keep OpenClaw output mapping.
- Modify `hermes-plugin/lore_memory/client.py` — add bridge client methods.
- Modify `hermes-plugin/lore_memory/__init__.py` — call bridge methods in `system_prompt_block`, `prefetch`, and cleanup.
- Modify tests in `pi-extension`, `openclaw-plugin`, and `hermes-plugin` to assert bridge calls.

## Shared Contracts

`POST /api/bridge/startup?client_type=<client>` request:

```json
{
  "session_id": "sess-1",
  "channel": "codex",
  "project": {
    "dir_name": "lore",
    "repo_name": "lore"
  },
  "include_guidance": true
}
```

Response:

```json
{
  "guidance": "Lore rules...",
  "boot_context": "## lore_boot 已加载内容...",
  "startup_recall_context": "以下记忆节点与当前环境高度相关...",
  "system_context": "Lore rules...\n\n## lore_boot...\n\n以下记忆节点...",
  "meta": {
    "client_type": "codex",
    "session_id": "sess-1",
    "channel": "codex",
    "queries": ["codex", "lore"]
  }
}
```

`POST /api/bridge/recall?client_type=<client>` request:

```json
{
  "session_id": "sess-1",
  "prompt": "current user prompt"
}
```

Response:

```json
{
  "context": "<recall session_id=\"sess-1\" query_id=\"q1\">\n0.80 | core://agent\n</recall>",
  "query_id": "q1",
  "node_uris": ["core://agent"],
  "has_recall": true,
  "data": { "items": [], "event_log": { "query_id": "q1" } }
}
```

`POST /api/bridge/session/end?client_type=<client>` request:

```json
{ "session_id": "sess-1" }
```

Response:

```json
{ "ok": true, "session_id": "sess-1" }
```

---

### Task 1: Backend bridge formatters and route contracts

**Files:**
- Create: `web/server/lore/bridge/format.ts`
- Create: `web/server/lore/bridge/startup.ts`
- Create: `web/server/lore/bridge/recall.ts`
- Create: `web/server/lore/bridge/session.ts`
- Create: `web/app/api/bridge/startup/route.ts`
- Create: `web/app/api/bridge/recall/route.ts`
- Create: `web/app/api/bridge/session/end/route.ts`
- Create: `web/app/api/bridge/__tests__/route.test.ts`

- [ ] **Step 1: Write RED route tests**

Create `web/app/api/bridge/__tests__/route.test.ts` with mocks for `bootView`, `recallMemories`, `loadRecallSafetyConfig`, `clearSessionReads`, `requireBearerAuth`, and `normalizeClientType`. Assert:

```ts
expect(body.system_context).toContain('GUIDANCE');
expect(body.boot_context).toContain('## lore_boot 已加载内容');
expect(body.startup_recall_context).toContain('<recall session_id="boot" query_id="q-start">');
expect(mockRecallMemories).toHaveBeenCalledWith(expect.objectContaining({ query: 'codex', session_id: 'boot' }), { clientType: 'codex' });
```

Add recall route assertion:

```ts
expect(body.context).toContain('<recall session_id="sess-1" query_id="q-prompt">');
expect(body.node_uris).toEqual(['core://agent']);
expect(body.has_recall).toBe(true);
```

Add session-end assertion:

```ts
expect(mockClearSessionReads).toHaveBeenCalledWith('sess-1');
expect(body).toEqual({ ok: true, session_id: 'sess-1' });
```

- [ ] **Step 2: Run RED test**

```bash
cd web && npm test -- --run app/api/bridge/__tests__/route.test.ts
```

Expected: FAIL because bridge files/routes do not exist.

- [ ] **Step 3: Implement `format.ts`**

Implement:

```ts
export function normalizeBridgeProject(project: unknown): { dirName: string; repoName: string | null }
export function buildStartupQueries(channel: string, project: BridgeProject): string[]
export function formatBridgeRecallBlock(items: unknown, sessionId?: string, queryId?: string): string
export function formatBridgeBootSection(data: BootResponse, clientType: ClientType | null): string
export function joinBridgeContext(parts: Array<string | null | undefined>): string
export function extractNodeUris(items: unknown): string[]
```

Use existing Pi/OpenClaw/Claude formatter behavior as the compatibility target. Keep score precision at two decimals.

- [ ] **Step 4: Implement service files**

`startup.ts`:

```ts
export async function buildStartupBridge(input: StartupBridgeInput): Promise<StartupBridgeResponse>
```

Call `bootView({ client_type: input.clientType })`, load guidance from `web/server/lore/guidance-reference.md` when `includeGuidance` is true, query recall for channel/project-dir/project-repo using `session_id: 'boot'`, and return formatted fields.

`recall.ts`:

```ts
export async function buildRecallBridge(input: RecallBridgeInput): Promise<RecallBridgeResponse>
```

Call `recallMemories({ query: prompt, session_id }, { clientType })`, format block, return query id and node URIs.

`session.ts`:

```ts
export async function endBridgeSession(input: EndBridgeSessionInput): Promise<{ ok: true; session_id: string }>
```

Call `clearSessionReads(sessionId)` when non-empty.

- [ ] **Step 5: Implement route files**

Each route uses `requireBearerAuth`, `normalizeClientType`, `jsonContractError`, and delegates to the service. Keep auth behavior consistent with `/api/browse/*`.

- [ ] **Step 6: Run GREEN test**

```bash
cd web && npm test -- --run app/api/bridge/__tests__/route.test.ts
```

Expected: PASS.

---

### Task 2: Migrate Claude Code and Codex hooks

**Files:**
- Modify: `claudecode-plugin/hooks/rules-inject.ts`
- Modify: `claudecode-plugin/hooks/recall-inject.ts`
- Modify: `codex-plugin/hooks/rules-inject.ts`
- Modify: `codex-plugin/hooks/recall-inject.ts`

- [ ] **Step 1: Add hook-level bridge helper**

In each hook file, add a tiny helper:

```ts
async function postBridge(pathname: string, body: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const cfg = loadConfig();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;
  const response = await fetch(`${cfg.baseUrl}/api/bridge/${pathname}?client_type=${CLIENT_TYPE}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  return response.json();
}
```

- [ ] **Step 2: Replace startup logic**

For Claude Code, replace boot + startup recall fetches with `postBridge('startup', { session_id, channel: 'claudecode', project: detectProjectInfo(), include_guidance: false }, BOOT_TIMEOUT_MS)`. Output `bridge.system_context`.

For Codex, preserve local static guidance loading, call bridge with `include_guidance: false`, and output `[rules, bridge.boot_context, bridge.startup_recall_context].filter(Boolean).join('\n\n')`.

- [ ] **Step 3: Replace prompt recall logic**

For both recall hooks, call `postBridge('recall', { session_id: sessionId, prompt }, cfg.timeoutMs)`. Claude writes `bridge.context` as raw stdout. Codex wraps `bridge.context` in `hookSpecificOutput.additionalContext`.

- [ ] **Step 4: Verify generated scripts compile by runtime tests**

There are no package tests for these standalone hooks. Run TypeScript syntax via `npx tsc --noEmit --allowJs false --target ES2022 --module ES2022 --moduleResolution bundler --skipLibCheck claudecode-plugin/hooks/rules-inject.ts claudecode-plugin/hooks/recall-inject.ts codex-plugin/hooks/rules-inject.ts codex-plugin/hooks/recall-inject.ts` if Node types are available; if Node type env blocks, document the existing env limitation and rely on web/plugin tests.

---

### Task 3: Migrate Pi lifecycle adapter

**Files:**
- Modify: `pi-extension/hooks.ts`
- Modify: `pi-extension/__tests__/hooks.test.ts`

- [ ] **Step 1: Write RED Pi hook test**

Update `before_agent_start injects guidance and recall as a message` so the mocked fetch expects:

```ts
if (String(url).includes('/bridge/startup')) return { system_context: 'BRIDGE SYSTEM' };
if (String(url).includes('/bridge/recall')) return { context: '<recall session_id="sess-2" query_id="q">...</recall>', has_recall: true };
```

Assert `result.systemPrompt` contains `BRIDGE SYSTEM`, `result.message.content` contains `<recall`, and no `/browse/boot` or `/browse/recall` calls are made.

- [ ] **Step 2: Run RED test**

```bash
cd pi-extension && npm test -- --run __tests__/hooks.test.ts
```

Expected: FAIL because hooks still call browse endpoints.

- [ ] **Step 3: Implement bridge helpers**

Add `fetchStartupBridge`, `fetchPromptRecallBridge`, and `endBridgeSession`. Keep `detectProjectInfo` local. Remove local `formatBootSection`, `fetchStartupRecallSection`, `cachedBootSection`, `cachedStartupRecallSections`, `setPendingRecallUsage`, and pending recall map tests if they become unused.

- [ ] **Step 4: Preserve Pi output mapping**

`before_agent_start` returns:

```ts
out.systemPrompt = [event?.systemPrompt || '', bridge.system_context].filter(Boolean).join('\n\n');
out.message = { customType: 'lore-recall', content: bridge.context, display: false, details: { source: 'lore', session_id: sessionId } };
```

`session_shutdown` calls bridge session-end and remains best effort.

- [ ] **Step 5: Run GREEN Pi tests**

```bash
cd pi-extension && npm test
```

Expected: PASS.

---

### Task 4: Migrate OpenClaw lifecycle adapter

**Files:**
- Modify: `openclaw-plugin/hooks.ts`
- Modify: `openclaw-plugin/__tests__/hooks.test.ts`

- [ ] **Step 1: Write RED OpenClaw hook test**

Update before_prompt_build tests so mocked fetch expects `/bridge/startup` and `/bridge/recall`, and assert output uses `appendSystemContext` and `prependContext` from bridge response.

- [ ] **Step 2: Run RED test**

```bash
cd openclaw-plugin && npm test -- --run __tests__/hooks.test.ts
```

Expected: FAIL because hooks still call browse endpoints.

- [ ] **Step 3: Implement bridge helpers**

Mirror Pi helper structure with OpenClaw naming and output shape. Remove local startup formatter and pending recall state if unused.

- [ ] **Step 4: Run GREEN OpenClaw tests**

```bash
cd openclaw-plugin && npm run build && npm test
```

Expected: PASS.

---

### Task 5: Migrate Hermes lifecycle adapter

**Files:**
- Modify: `hermes-plugin/lore_memory/client.py`
- Modify: `hermes-plugin/lore_memory/__init__.py`
- Modify: `hermes-plugin/lore_memory/test_thin_adapters.py`

- [ ] **Step 1: Write RED Hermes tests**

Add client tests for:

```py
client.bridge_startup(session_id='s1', channel='hermes', project={'dir_name': 'lore', 'repo_name': 'lore'}, include_guidance=False)
client.bridge_recall(session_id='s1', prompt='hello')
client.bridge_session_end(session_id='s1')
```

Assert `_request` paths are `/bridge/startup`, `/bridge/recall`, `/bridge/session/end`.

Add provider tests asserting `system_prompt_block()` uses `system_context` and `prefetch()` returns `context`.

- [ ] **Step 2: Run RED test**

```bash
cd hermes-plugin && python3 lore_memory/test_thin_adapters.py
```

Expected: FAIL because bridge client methods do not exist.

- [ ] **Step 3: Implement client methods**

In `client.py`:

```py
def bridge_startup(self, *, session_id: str, channel: str, project: Dict, include_guidance: bool = False) -> Dict:
    return self._request('POST', '/bridge/startup', data={...}) or {}
```

Implement recall and session-end similarly.

- [ ] **Step 4: Update provider**

`system_prompt_block()` calls bridge startup and returns `system_context` when available. `prefetch()` calls bridge recall and returns `context`. Keep fallback to existing direct calls only if bridge response is empty or raises, so current deployments degrade gracefully.

- [ ] **Step 5: Run GREEN Hermes tests**

```bash
cd hermes-plugin && python3 lore_memory/test_thin_adapters.py
```

Expected: PASS.

---

### Task 6: Cleanup, verification, and push

**Files:**
- Modify: files touched above
- Test: all relevant suites

- [ ] **Step 1: Remove unused duplicate lifecycle helpers**

Search:

```bash
rg -n "formatBootSection|formatRecallBlock|pendingRecallUsage|setPendingRecallUsage|consumePendingRecallUsage|/browse/boot|/browse/recall" claudecode-plugin codex-plugin pi-extension openclaw-plugin hermes-plugin -g '!node_modules' -g '!dist'
```

Keep direct browse calls in tools (`lore_boot`, `lore_search`, `lore_get_node`) and remove lifecycle-only duplicates.

- [ ] **Step 2: Full verification**

Run:

```bash
cd web && npm test -- --run app/api/bridge/__tests__/route.test.ts server/__tests__/mcpServer.test.ts
cd pi-extension && npm test
cd openclaw-plugin && npm run build && npm test
cd hermes-plugin && python3 lore_memory/test_thin_adapters.py
```

- [ ] **Step 3: Commit and push**

```bash
git add web claudecode-plugin codex-plugin pi-extension openclaw-plugin hermes-plugin docs/superpowers/plans/2026-05-18-lore-bridge.md
git commit -m "feat: add Lore lifecycle bridge"
git push -u origin feat/lore-bridge
```

---

## Self-Review

- Spec coverage: backend bridge, Claude/Codex, Pi/OpenClaw, Hermes, cleanup, verification are all covered.
- Placeholder scan: no TBD/TODO placeholders; each task has exact files and commands.
- Type consistency: request/response names use `startup`, `recall`, `session/end`, `system_context`, `context`, `session_id`, `client_type`, and `project` consistently.

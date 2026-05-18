import { sql } from '../../db';
import { getSetting } from '../config/settings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_CAPS: Record<number, number> = { 0: 5, 1: 15 };
const DISCLOSURE_OR_RE = /或者|[，。、；\s]或[，。、；\s]|以及/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyResult {
  errors: string[];
  warnings: string[];
}

export interface CreatePolicyOptions {
  priority?: number | string | null;
  disclosure?: string | null;
}

export interface UpdatePolicyOptions {
  domain?: string;
  path?: string;
  priority?: number | string | null;
  disclosure?: string | null;
}

export interface DeletePolicyOptions {
  domain?: string;
  path?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPriorityBudget(): Promise<Record<number, number>> {
  const result = await sql(
    `SELECT priority, COUNT(*)::int AS cnt FROM edges WHERE priority IN (0, 1) GROUP BY priority`,
  );
  const counts: Record<number, number> = { 0: 0, 1: 0 };
  for (const row of result.rows) {
    const r = row as { priority: number; cnt: number };
    counts[r.priority] = r.cnt;
  }
  return counts;
}

async function getCurrentPriority(domain: string | undefined, path: string | undefined): Promise<number | null> {
  const result = await sql(
    `SELECT e.priority FROM paths p JOIN edges e ON p.edge_id = e.id WHERE p.domain = $1 AND p.path = $2 LIMIT 1`,
    [domain, path],
  );
  const row = result.rows[0] as { priority: number } | undefined;
  return row?.priority ?? null;
}

function checkDisclosureOrLogic(disclosure: string | null | undefined): boolean {
  if (!disclosure || typeof disclosure !== 'string') return false;
  return DISCLOSURE_OR_RE.test(disclosure);
}

// ---------------------------------------------------------------------------
// Exported validators
// ---------------------------------------------------------------------------

export async function validateCreatePolicy({ priority, disclosure }: CreatePolicyOptions = {}): Promise<PolicyResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Priority budget
  if (await getSetting('policy.priority_budget_enabled')) {
    const p = Number(priority);
    if (p <= 1 && Number.isFinite(p)) {
      const counts = await getPriorityBudget();
      const cap = PRIORITY_CAPS[p];
      if (cap !== undefined && counts[p] >= cap) {
        errors.push(`Priority ${p} 容量已满（${counts[p]}/${cap}）。请先降级一个现有 priority ${p} 节点。`);
      }
    }
  }

  // Disclosure presence & quality
  if (await getSetting('policy.disclosure_warning_enabled')) {
    if (!disclosure || !String(disclosure).trim()) {
      warnings.push('未填写 disclosure。缺少 disclosure 的记忆更难被召回。');
    } else if (checkDisclosureOrLogic(disclosure)) {
      warnings.push('Disclosure 包含 OR 逻辑（或/或者/以及）。建议拆分为多个节点，每个节点单一触发条件。');
    }
  }

  return { errors, warnings };
}

export async function validateUpdatePolicy({ domain, path, priority, disclosure }: UpdatePolicyOptions = {}): Promise<PolicyResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Priority budget (only when changing priority to 0 or 1)
  if (priority !== undefined && (await getSetting('policy.priority_budget_enabled'))) {
    const p = Number(priority);
    if (p <= 1 && Number.isFinite(p)) {
      const currentPriority = await getCurrentPriority(domain, path);
      // Only check budget if the node is moving TO this priority level (not already there)
      if (currentPriority !== p) {
        const counts = await getPriorityBudget();
        const cap = PRIORITY_CAPS[p];
        if (cap !== undefined && counts[p] >= cap) {
          errors.push(`Priority ${p} 容量已满（${counts[p]}/${cap}）。请先降级一个现有 priority ${p} 节点。`);
        }
      }
    }
  }

  // Disclosure OR-logic (only when disclosure is being updated)
  if (disclosure !== undefined && (await getSetting('policy.disclosure_warning_enabled'))) {
    if (checkDisclosureOrLogic(disclosure)) {
      warnings.push('Disclosure 包含 OR 逻辑（或/或者/以及）。建议拆分为多个节点，每个节点单一触发条件。');
    }
  }

  return { errors, warnings };
}

export async function validateDeletePolicy(_options: DeletePolicyOptions = {}): Promise<PolicyResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  return { errors, warnings };
}

import { NextRequest, NextResponse } from 'next/server';
import { normalizeClientType, requireBearerAuth } from '../../../../../server/auth';
import { debugRecallMemories } from '../../../../../server/lore/recall/recall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildDebugBody(searchParams: URLSearchParams): Record<string, unknown> {
  return {
    query: String(searchParams.get('query') || '').trim(),
    session_id: String(searchParams.get('session_id') || '').trim() || undefined,
    limit: searchParams.get('limit') != null ? Number(searchParams.get('limit')) : undefined,
    min_score: searchParams.get('min_score') != null ? Number(searchParams.get('min_score')) : undefined,
    max_display_items: searchParams.get('max_display_items') != null ? Number(searchParams.get('max_display_items')) : undefined,
    min_display_score: searchParams.get('min_display_score') != null ? Number(searchParams.get('min_display_score')) : undefined,
    score_precision: searchParams.get('score_precision') != null ? Number(searchParams.get('score_precision')) : undefined,
    exclude_boot_from_results: searchParams.get('exclude_boot_from_results') == null
      ? undefined
      : ['1', 'true', 'yes', 'on'].includes(String(searchParams.get('exclude_boot_from_results')).toLowerCase()),
    log_events: true,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const clientType = normalizeClientType(request.nextUrl.searchParams.get('client_type'));
    return NextResponse.json(await debugRecallMemories(buildDebugBody(request.nextUrl.searchParams), { clientType }));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Recall debug failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    const clientType = normalizeClientType(request.nextUrl.searchParams.get('client_type'));
    return NextResponse.json(await debugRecallMemories(body, { clientType }));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Recall debug failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

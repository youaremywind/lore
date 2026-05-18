import { NextRequest, NextResponse } from 'next/server';

import { normalizeClientType, requireBearerAuth } from '@/server/auth';
import { buildStartupBridge } from '@/server/lore/bridge/startup';
import { jsonContractError } from '@/server/lore/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const clientType = normalizeClientType(new URL(request.url).searchParams.get('client_type') || body?.client_type);
    return NextResponse.json(await buildStartupBridge({
      clientType,
      sessionId: body?.session_id,
      channel: body?.channel,
      project: body?.project,
      includeGuidance: body?.include_guidance === true,
    }));
  } catch (error) {
    return jsonContractError(error, 'Bridge startup failed');
  }
}

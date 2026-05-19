import { NextRequest, NextResponse } from 'next/server';

import { normalizeClientType, requireBearerAuth } from '@/server/auth';
import { buildRecallBridge } from '@/server/lore/bridge/recall';
import { jsonContractError } from '@/server/lore/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const clientType = normalizeClientType(new URL(request.url).searchParams.get('client_type') || body?.client_type);
    return NextResponse.json(await buildRecallBridge({
      clientType,
      sessionId: body?.session_id,
      prompt: body?.prompt,
    }));
  } catch (error) {
    return jsonContractError(error, 'Bridge recall failed');
  }
}

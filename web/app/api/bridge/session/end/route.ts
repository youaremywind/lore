import { NextRequest, NextResponse } from 'next/server';

import { requireBearerAuth } from '@/server/auth';
import { endBridgeSession } from '@/server/lore/bridge/session';
import { jsonContractError } from '@/server/lore/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    return NextResponse.json(await endBridgeSession({ sessionId: body?.session_id }));
  } catch (error) {
    return jsonContractError(error, 'Bridge session end failed');
  }
}

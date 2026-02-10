import { NextRequest } from 'next/server';
import { handleAuth } from '@/lib/auth';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const result = await handleAuth(req);
    return Response.json(result, { headers: corsHeaders });
  } catch (err: any) {
    const status = err.message?.includes('Missing') ? 401 : 500;
    return Response.json(
      { error: err.message || 'Internal error' },
      { status, headers: corsHeaders }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  let body: { text?: string; screenshot_base64?: string; userEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders });
  }

  if (!body.text || body.text.trim().length === 0) {
    return NextResponse.json({ error: 'Feedback text is required' }, { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
  );

  const { error } = await supabase.from('feedback').insert({
    user_email: body.userEmail || 'anonymous',
    text: body.text.trim(),
    screenshot_b64: body.screenshot_base64 || null,
  });

  if (error) {
    console.error('[feedback] Supabase insert error:', error.message);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}

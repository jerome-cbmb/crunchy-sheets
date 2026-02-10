import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

export async function trackUsage(
  googleId: string,
  data: { tokensIn: number; tokensOut: number; skill: string | null }
): Promise<void> {
  try {
    await supabase.from('users').upsert(
      { google_id: googleId },
      { onConflict: 'google_id' }
    );

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('google_id', googleId)
      .single();

    if (!user) return;

    await supabase.from('usage').insert({
      user_id: user.id,
      tokens_in: data.tokensIn,
      tokens_out: data.tokensOut,
      skill_used: data.skill,
    });
  } catch (err) {
    console.error('Usage tracking error (non-fatal):', err);
  }
}

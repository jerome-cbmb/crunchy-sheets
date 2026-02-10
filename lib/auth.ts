import { createClient } from '@supabase/supabase-js';
import { GoogleUser } from './types';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

/**
 * Verify a Google OAuth access token by calling Google's userinfo endpoint.
 */
export async function verifyGoogleToken(token: string): Promise<GoogleUser> {
  const response = await fetch(
    'https://www.googleapis.com/oauth2/v3/userinfo',
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Google token verification failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, any>;

  if (!data.sub || !data.email) {
    throw new Error('Invalid token: missing sub or email');
  }

  return {
    sub: data.sub as string,
    email: data.email as string,
    name: data.name as string | undefined,
    picture: data.picture as string | undefined,
  };
}

/**
 * Handle the /auth endpoint. Verifies token + upserts user.
 */
export async function handleAuth(req: Request): Promise<{ user: any; isNew: boolean }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.split(' ')[1];
  const googleUser = await verifyGoogleToken(token);

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('google_id', googleUser.sub)
    .single();

  if (existing) {
    return { user: existing, isNew: false };
  }

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      google_id: googleUser.sub,
      email: googleUser.email,
      plan: 'free',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  }

  return { user: newUser!, isNew: true };
}

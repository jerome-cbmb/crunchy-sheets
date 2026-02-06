/**
 * auth.ts — OAuth Token Verification & User Management
 *
 * Verifies Google OAuth tokens sent from the Apps Script add-on,
 * creates/updates user records in Supabase.
 *
 * Flow:
 *   1. Apps Script sends Bearer token (Google access token)
 *   2. We verify it against Google's tokeninfo endpoint
 *   3. Extract google_id (sub) and email
 *   4. Upsert into Supabase users table
 *   5. Return user record + session info
 */

import { OAuth2Client } from 'google-auth-library';
import { Request } from '@google-cloud/functions-framework';
import { createClient } from '@supabase/supabase-js';

// ─── Clients ─────────────────────────────────────────────────────────────────

const oauthClient = new OAuth2Client();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GoogleUser {
  sub: string;      // Google user ID
  email: string;
  name?: string;
  picture?: string;
}

interface AuthResponse {
  user: {
    id: string;
    google_id: string;
    email: string;
    plan: string;
    created_at: string;
  };
  isNew: boolean;
}

// ─── Token Verification ─────────────────────────────────────────────────────

/**
 * Verify a Google OAuth access token by calling Google's userinfo endpoint.
 *
 * @param token - The Bearer token from Apps Script.
 * @returns GoogleUser with sub, email, etc.
 */
export async function verifyGoogleToken(token: string): Promise<GoogleUser> {
  const response = await fetch(
    `https://www.googleapis.com/oauth2/v3/userinfo`,
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

// ─── Auth Handler ────────────────────────────────────────────────────────────

/**
 * Handle the /auth endpoint. Verifies token + upserts user.
 */
export async function handleAuth(req: Request): Promise<AuthResponse> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.split(' ')[1];
  const googleUser = await verifyGoogleToken(token);

  // Check if user exists
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('google_id', googleUser.sub)
    .single();

  if (existing) {
    return {
      user: existing,
      isNew: false,
    };
  }

  // Create new user
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

  return {
    user: newUser!,
    isNew: true,
  };
}

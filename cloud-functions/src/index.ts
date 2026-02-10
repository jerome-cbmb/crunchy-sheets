/**
 * index.ts — Cloud Function Entry Points
 *
 * Two HTTP functions:
 *   - analyze: Accepts workbook state + prompt, calls Claude, returns actions
 *   - auth:    Verifies Google OAuth tokens, manages user records
 */

import * as ff from '@google-cloud/functions-framework';
import { handleAnalyze } from './analyze';
import { handleAuth } from './auth';

// ─── /analyze ────────────────────────────────────────────────────────────────
ff.http('analyze', async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const result = await handleAnalyze(req);
    res.status(200).json(result);
  } catch (err: any) {
    console.error('analyze error:', err);
    const message = err.error?.error?.message || err.message || 'Internal error';
    res.status(err.status || 500).json({ error: message });
  }
});

// ─── /auth ───────────────────────────────────────────────────────────────────
ff.http('auth', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const result = await handleAuth(req);
    res.status(200).json(result);
  } catch (err: any) {
    console.error('auth error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

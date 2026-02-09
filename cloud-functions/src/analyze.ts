/**
 * analyze.ts — Workbook Analysis Endpoint
 *
 * Receives the serialized workbook state + user prompt from the Apps Script
 * sidebar, routes to the appropriate skill, calls Claude, and returns
 * structured actions (cell writes, formatting, commentary).
 *
 * This is the core of the RLM approach: the entire workbook state is in
 * context for every interaction. No RAG, no chunking.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Request } from '@google-cloud/functions-framework';
import { verifyGoogleToken } from './auth';
import { routeToSkill, SkillContext } from './skill-router';
import { parseClaudeResponse, buildActionInstructions } from './action-parser';
import { createClient } from '@supabase/supabase-js';

// ─── Clients ─────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Crunchy Sheets, an AI CFO that lives inside Google Sheets.
You understand financial workbooks structurally — tabs, formulas, named ranges, dependencies.
You think like a seasoned financial analyst.

FORMATTING RULES (non-negotiable):
- Blue (#0000FF) font for hard-coded inputs
- Black (#000000) font for formulas
- Green (#008000) font for cross-tab references
- Use named ranges wherever possible
- Organize tabs logically: Assumptions → Calculations → Outputs → Dashboard

When asked to modify a workbook, return structured actions in the "actions" array.
Each action has a type (set_value, set_formula, format_cell, add_sheet, etc.)
and the target cell reference.

When asked to analyze, return your analysis in the "response" field as clear,
concise financial commentary. Reference specific cells (e.g., "Cell B14 shows...").

Always be opinionated about structure. A well-organized model is worth more than
a technically correct but messy one.

${buildActionInstructions()}`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnalyzeRequest {
  workbookState: any;
  prompt: string;
  skill?: string;
  spreadsheetId: string;
  userEmail: string;
}

export interface CellAction {
  type: 'set_value' | 'set_formula' | 'format_cell' | 'add_sheet' | 'rename_sheet' | 'add_named_range';
  sheet?: string;
  cell?: string;
  value?: any;
  formula?: string;
  format?: {
    fontColor?: string;
    background?: string;
    bold?: boolean;
    numberFormat?: string;
  };
  sheetName?: string;
  rangeName?: string;
  rangeA1?: string;
}

interface AnalyzeResponse {
  response: string;
  actions: CellAction[];
  skill: string | null;
  model: string;
  tokensIn: number;
  tokensOut: number;
  summary?: string;
  parseErrors?: string[];
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleAnalyze(req: Request): Promise<AnalyzeResponse> {
  const body: AnalyzeRequest = req.body;

  // 1. Verify the Google OAuth token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const token = authHeader.split(' ')[1];
  const googleUser = await verifyGoogleToken(token);

  // 2. Determine skill (explicit or auto-detect)
  const skillContext: SkillContext = routeToSkill(body.prompt, body.skill);

  // 3. Build the Claude prompt
  const workbookStateStr = JSON.stringify(body.workbookState, null, 2);
  const userMessage = buildUserMessage(body.prompt, workbookStateStr, skillContext);

  // 4. Select model based on skill tier
  const model = skillContext.modelTier === 'opus'
    ? 'claude-opus-4-6-20250205'
    : 'claude-sonnet-4-5-20250514';

  // 5. Call Claude
  const message = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT + (skillContext.systemAddendum || ''),
    messages: [
      { role: 'user', content: userMessage }
    ],
  });

  // 6. Parse response
  const responseText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Parse structured actions from Claude's response
  const parsed = parseClaudeResponse(responseText);

  const result: AnalyzeResponse = {
    response: parsed.response,
    actions: parsed.actions,
    skill: skillContext.skillId,
    model,
    tokensIn: message.usage.input_tokens,
    tokensOut: message.usage.output_tokens,
    summary: parsed.summary,
    ...(parsed.parseErrors && { parseErrors: parsed.parseErrors }),
  };

  // 7. Track usage in Supabase
  await trackUsage(googleUser.sub, result);

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildUserMessage(prompt: string, workbookState: string, skill: SkillContext): string {
  let msg = '';

  if (skill.skillId) {
    msg += `[Active Skill: ${skill.skillId}]\n${skill.instruction}\n\n`;
  }

  msg += `## Current Workbook State\n\`\`\`json\n${workbookState}\n\`\`\`\n\n`;
  msg += `## User Request\n${prompt}`;

  return msg;
}

async function trackUsage(googleId: string, result: AnalyzeResponse): Promise<void> {
  try {
    // Upsert user
    await supabase.from('users').upsert(
      { google_id: googleId },
      { onConflict: 'google_id' }
    );

    // Get user id
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('google_id', googleId)
      .single();

    if (!user) return;

    // Insert usage record
    await supabase.from('usage').insert({
      user_id: user.id,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      skill_used: result.skill,
    });
  } catch (err) {
    console.error('Usage tracking error (non-fatal):', err);
  }
}

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
  maxRetries: 0,
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

COMMUNICATION STYLE:
- You live in a narrow Google Sheets sidebar. Keep responses SHORT.
- For greetings or simple questions: 1-2 sentences max.
- For analysis: concise bullet points, not paragraphs. Reference specific cells.
- For modifications: brief summary of what you'll change. Let the actions panel speak for itself.
- Never list your capabilities unprompted. The user can see the skill chips.
- No filler phrases ("I'd be happy to", "Great question", "Let me help you with that").
- Be direct, opinionated, and finance-flavored.

TEMPORAL AWARENESS:
Today's date is ${new Date().toISOString().split('T')[0]}.
- When referencing time periods in the workbook, say "most recent actuals (through [period])" not "current state ([period])".
- If the most recent data is more than 6 months old relative to today, note it: "Note: the most recent data is from [period], which is [N] months ago."
- Never assume data represents "the present" — it represents the most recent reporting period.

USER CONTEXT:
- Refer to the workbook neutrally: "this model shows..." not "your forecast..."
- Don't assume the user created the workbook. They may be reviewing, auditing, or inheriting it.
- If a user role is provided, adjust your tone:
  - Builder: direct, technical, assume familiarity with the model
  - Reviewer: focus on risks, inconsistencies, and flags
  - Inherited: help them understand structure and assumptions
  - Exploring: be descriptive, explain what each tab does

${buildActionInstructions()}`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnalyzeRequest {
  workbookState: any;
  prompt: string;
  skill?: string;
  spreadsheetId: string;
  userEmail: string;
  userRole?: string;
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
  formulaXray?: any;
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
  const workbookStateStr = JSON.stringify(body.workbookState);

  // Safety net: reject if workbook context would blow the token limit
  const estimatedTokens = Math.ceil(workbookStateStr.length / 4);
  if (estimatedTokens > 150000) {
    throw new Error(`Workbook context too large (~${Math.round(estimatedTokens / 1000)}K tokens). Try switching to a smaller tab and resending.`);
  }

  const userMessage = buildUserMessage(body.prompt, workbookStateStr, skillContext, body.userRole);

  // 4. Select model based on skill tier
  const model = skillContext.modelTier === 'opus'
    ? 'claude-opus-4-6'
    : 'claude-sonnet-4-6';

  // 5. Call Claude
  const message = await anthropic.messages.create({
    model,
    max_tokens: skillContext.maxTokens,
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
    ...(parsed.formulaXray && { formulaXray: parsed.formulaXray }),
  };

  // 7. Track usage in Supabase
  await trackUsage(googleUser.sub, result);

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildUserMessage(prompt: string, workbookState: string, skill: SkillContext, userRole?: string): string {
  let msg = '';

  if (userRole) {
    const roleDescriptions: Record<string, string> = {
      builder: 'The user built or maintains this model. Be direct and technical.',
      reviewer: 'The user is reviewing or auditing this model. Focus on risks and flags.',
      inherited: 'The user inherited this model from someone else. Help them understand it.',
      exploring: 'The user is exploring this model. Be descriptive about structure and purpose.',
    };
    msg += `[User Role: ${userRole}] ${roleDescriptions[userRole] || ''}\n\n`;
  }

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

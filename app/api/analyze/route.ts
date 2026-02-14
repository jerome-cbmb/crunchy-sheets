import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { verifyGoogleToken } from '@/lib/auth';
import { routeToSkill } from '@/lib/skill-router';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { trackUsage } from '@/lib/usage';
import { AnalyzeRequest, SkillContext, ConversationEntry } from '@/lib/types';

export const maxDuration = 60;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  // 1. Auth (fail fast)
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  let googleUser;
  try {
    googleUser = await verifyGoogleToken(authHeader.split(' ')[1]);
  } catch {
    return new Response('Invalid token', { status: 401, headers: corsHeaders });
  }

  // 2. Parse body
  let body: AnalyzeRequest;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
  }

  // 3. Route skill
  const skillContext = routeToSkill(body.prompt, body.skill);

  // 4. Token guard
  const contextStr = body.isStructuralPass
    ? JSON.stringify(body.structuralModel || '') + JSON.stringify(body.requestedData || '') + JSON.stringify(body.conversationHistory || '')
    : JSON.stringify(body.workbookState || '');
  const estimatedTokens = Math.ceil(contextStr.length / 4);
  if (estimatedTokens > 150000) {
    return new Response(
      `Workbook context too large (~${Math.round(estimatedTokens / 1000)}K tokens) even after adaptive truncation. Try switching to a smaller tab or closing large proof/output tabs.`,
      { status: 413, headers: corsHeaders }
    );
  }

  // 5. Build user message
  const userMessage = body.isStructuralPass
    ? buildStructuralUserMessage(body.prompt, body.structuralModel, skillContext, body.userRole, body.requestedData, body.conversationHistory)
    : buildUserMessage(body.prompt, JSON.stringify(body.workbookState), skillContext, body.userRole, body.crossRefGraph);

  // 6. Select model
  const modelId = skillContext.modelTier === 'opus'
    ? 'claude-opus-4-6'
    : 'claude-sonnet-4-5-20250929';

  // 7. Build system prompt with fresh date
  const systemPrompt = buildSystemPrompt(new Date().toISOString().split('T')[0])
    + (skillContext.systemAddendum || '');

  // 8. Stream
  const result = streamText({
    model: anthropic(modelId),
    maxTokens: skillContext.maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    onFinish: async ({ usage }) => {
      await trackUsage(googleUser.sub, {
        tokensIn: usage.promptTokens,
        tokensOut: usage.completionTokens,
        skill: skillContext.skillId,
      }).catch(console.error);
    },
  });

  return result.toTextStreamResponse({ headers: corsHeaders });
}

function buildUserMessage(
  prompt: string,
  workbookState: string,
  skill: SkillContext,
  userRole?: string,
  crossRefGraph?: any
): string {
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

  if (crossRefGraph) {
    msg += `## Cross-Reference Graph\n\`\`\`json\n${JSON.stringify(crossRefGraph)}\n\`\`\`\n\n`;
  }

  msg += `## User Request\n${prompt}`;

  return msg;
}

function buildStructuralUserMessage(
  prompt: string,
  structuralModel: any,
  skill: SkillContext,
  userRole?: string,
  requestedData?: Record<string, any>,
  conversationHistory?: ConversationEntry[]
): string {
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

  msg += `## Workbook Structure\n\`\`\`json\n${JSON.stringify(structuralModel)}\n\`\`\`\n\n`;

  if (requestedData) {
    msg += `## Requested Cell Data\n\`\`\`json\n${JSON.stringify(requestedData)}\n\`\`\`\n\n`;
  }

  if (conversationHistory && conversationHistory.length > 0) {
    msg += `## Previous Exchanges\n`;
    for (const entry of conversationHistory) {
      msg += `**${entry.role}:** ${entry.content}`;
      if (entry.fetchedRanges && entry.fetchedRanges.length > 0) {
        msg += ` [fetched: ${entry.fetchedRanges.join(', ')}]`;
      }
      msg += '\n\n';
    }
  }

  msg += `## User Request\n${prompt}`;

  return msg;
}

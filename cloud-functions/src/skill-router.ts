/**
 * skill-router.ts — Routes User Prompts to Financial Skills
 *
 * Each skill has:
 *   - A system addendum (appended to the base system prompt)
 *   - An instruction prefix (prepended to the user message)
 *   - A model tier (sonnet for fast, opus for complex reasoning)
 *
 * Routing is either:
 *   - Explicit: user selected a skill in the sidebar (skill param set)
 *   - Auto-detected: keywords in the prompt match a skill
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillContext {
  skillId: string | null;
  modelTier: 'sonnet' | 'opus';
  instruction: string;
  systemAddendum: string;
}

interface SkillDefinition {
  id: string;
  modelTier: 'sonnet' | 'opus';
  keywords: RegExp;
  instruction: string;
  systemAddendum: string;
}

// ─── Skill Definitions ──────────────────────────────────────────────────────

const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    id: 'variance_analysis',
    modelTier: 'sonnet',
    keywords: /variance|budget.*actual|actual.*budget|fluctuation|deviation/i,
    instruction: 'Perform a variance analysis. Compare actuals to budget/forecast. For each significant variance (>5%), explain the likely driver.',
    systemAddendum: '\nFor variance analysis, always show: Line Item | Budget | Actual | $ Variance | % Variance | Explanation.',
  },
  {
    id: 'cash_flow_forecast',
    modelTier: 'opus',
    keywords: /cash.*flow|forecast|runway|burn.*rate|13.*week/i,
    instruction: 'Build or analyze a cash flow forecast. Project cash position forward with weekly or monthly granularity.',
    systemAddendum: '\nFor cash flow forecasts, use a waterfall structure: Beginning Cash → Inflows → Outflows → Net Change → Ending Cash. Highlight danger zones (< 2 months runway) in red.',
  },
  {
    id: 'revenue_waterfall',
    modelTier: 'sonnet',
    keywords: /revenue.*waterfall|mrr.*bridge|arr.*bridge|churn|expansion.*revenue/i,
    instruction: 'Build a revenue waterfall/bridge analysis. Show: Beginning → New → Expansion → Churn → Contraction → Ending.',
    systemAddendum: '',
  },
  {
    id: 'expense_categorization',
    modelTier: 'sonnet',
    keywords: /categoriz|classif|expense.*type|cogs|opex|capex/i,
    instruction: 'Categorize expenses into standard categories: COGS, OpEx (Sales & Marketing, R&D, G&A), CapEx, Other.',
    systemAddendum: '',
  },
  {
    id: 'unit_economics',
    modelTier: 'opus',
    keywords: /unit.*econ|cac|ltv|payback|gross.*margin.*unit|customer.*acquisition/i,
    instruction: 'Calculate unit economics: CAC, LTV, LTV:CAC ratio, payback period, gross margin per unit.',
    systemAddendum: '\nFor unit economics, clearly separate blended vs channel-specific metrics. Flag if LTV:CAC < 3:1.',
  },
  {
    id: 'cohort_analysis',
    modelTier: 'opus',
    keywords: /cohort|retention|churn.*rate.*month|roll.*forward/i,
    instruction: 'Build or analyze cohort retention/revenue tables with monthly roll-forward.',
    systemAddendum: '\nFor cohort analysis, use a triangular matrix with cohort months as rows and periods as columns.',
  },
  {
    id: 'scenario_modeling',
    modelTier: 'opus',
    keywords: /scenario|sensitiv|what.*if|optimistic|pessimistic|base.*case/i,
    instruction: 'Add scenario analysis with Base/Optimistic/Pessimistic toggles using named ranges and SWITCH().',
    systemAddendum: '\nFor scenarios, use a single "Scenario_Toggle" named range (1=Base, 2=Optimistic, 3=Pessimistic). All scenario-dependent cells should reference this toggle via SWITCH().',
  },
  {
    id: 'kpi_dashboard',
    modelTier: 'sonnet',
    keywords: /dashboard|kpi|metric.*summary|sparkline/i,
    instruction: 'Build a KPI dashboard with key metrics, SPARKLINE charts, and conditional formatting.',
    systemAddendum: '\nFor dashboards, use SPARKLINE() for inline charts. Green for positive trends, red for negative. Group metrics by category.',
  },
  {
    id: 'investor_metrics',
    modelTier: 'sonnet',
    keywords: /investor|board.*deck|rule.*40|magic.*number|arr|mrr/i,
    instruction: 'Calculate investor-ready metrics: MRR/ARR, growth rate, burn rate, runway, Rule of 40, magic number, net dollar retention.',
    systemAddendum: '',
  },
  {
    id: 'budget_vs_actual',
    modelTier: 'sonnet',
    keywords: /budget.*vs|vs.*actual|bva|plan.*vs/i,
    instruction: 'Create a side-by-side budget vs actual comparison with $ and % variance, conditional formatting.',
    systemAddendum: '\nFor BvA, highlight favorable variances in green and unfavorable in red. Add a commentary column for top-5 variances.',
  },
];

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * Route to the appropriate skill based on explicit selection or prompt keywords.
 *
 * @param prompt - The user's prompt text.
 * @param explicitSkillId - Skill ID if user explicitly selected one.
 * @returns SkillContext with routing info.
 */
export function routeToSkill(prompt: string, explicitSkillId?: string): SkillContext {
  // 1. Explicit skill selection
  if (explicitSkillId) {
    const skill = SKILL_DEFINITIONS.find(s => s.id === explicitSkillId);
    if (skill) {
      return {
        skillId: skill.id,
        modelTier: skill.modelTier,
        instruction: skill.instruction,
        systemAddendum: skill.systemAddendum,
      };
    }
  }

  // 2. Check for [skill:xxx] prefix from sidebar
  const skillPrefix = prompt.match(/\[skill:(\w+)\]/);
  if (skillPrefix) {
    const skill = SKILL_DEFINITIONS.find(s => s.id === skillPrefix[1]);
    if (skill) {
      return {
        skillId: skill.id,
        modelTier: skill.modelTier,
        instruction: skill.instruction,
        systemAddendum: skill.systemAddendum,
      };
    }
  }

  // 3. Auto-detect from keywords
  for (const skill of SKILL_DEFINITIONS) {
    if (skill.keywords.test(prompt)) {
      return {
        skillId: skill.id,
        modelTier: skill.modelTier,
        instruction: skill.instruction,
        systemAddendum: skill.systemAddendum,
      };
    }
  }

  // 4. Default: general analysis (sonnet)
  return {
    skillId: null,
    modelTier: 'sonnet',
    instruction: '',
    systemAddendum: '',
  };
}

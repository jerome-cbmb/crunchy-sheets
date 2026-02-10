import { SkillContext, SkillDefinition } from './types';

// ─── Skill Definitions ──────────────────────────────────────────────────────

const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    id: 'variance_analysis',
    modelTier: 'sonnet',
    maxTokens: 4096,
    keywords: /variance|budget.*actual|actual.*budget|fluctuation|deviation/i,
    instruction: 'Perform a variance analysis. Compare actuals to budget/forecast. For each significant variance (>5%), explain the likely driver.',
    systemAddendum: '\nFor variance analysis, always show: Line Item | Budget | Actual | $ Variance | % Variance | Explanation.',
  },
  {
    id: 'cash_flow_forecast',
    modelTier: 'opus',
    maxTokens: 8192,
    keywords: /cash.*flow|forecast|runway|burn.*rate|13.*week/i,
    instruction: 'Build or analyze a cash flow forecast. Project cash position forward with weekly or monthly granularity.',
    systemAddendum: '\nFor cash flow forecasts, use a waterfall structure: Beginning Cash → Inflows → Outflows → Net Change → Ending Cash. Highlight danger zones (< 2 months runway) in red.',
  },
  {
    id: 'revenue_waterfall',
    modelTier: 'sonnet',
    maxTokens: 8192,
    keywords: /revenue.*waterfall|mrr.*bridge|arr.*bridge|churn|expansion.*revenue/i,
    instruction: 'Build a revenue waterfall/bridge analysis. Show: Beginning → New → Expansion → Churn → Contraction → Ending.',
    systemAddendum: '',
  },
  {
    id: 'expense_categorization',
    modelTier: 'sonnet',
    maxTokens: 4096,
    keywords: /categoriz|classif|expense.*type|cogs|opex|capex/i,
    instruction: 'Categorize expenses into standard categories: COGS, OpEx (Sales & Marketing, R&D, G&A), CapEx, Other.',
    systemAddendum: '',
  },
  {
    id: 'unit_economics',
    modelTier: 'opus',
    maxTokens: 4096,
    keywords: /unit.*econ|cac|ltv|payback|gross.*margin.*unit|customer.*acquisition/i,
    instruction: 'Calculate unit economics: CAC, LTV, LTV:CAC ratio, payback period, gross margin per unit.',
    systemAddendum: '\nFor unit economics, clearly separate blended vs channel-specific metrics. Flag if LTV:CAC < 3:1.',
  },
  {
    id: 'cohort_analysis',
    modelTier: 'opus',
    maxTokens: 8192,
    keywords: /cohort|retention|churn.*rate.*month|roll.*forward/i,
    instruction: 'Build or analyze cohort retention/revenue tables with monthly roll-forward.',
    systemAddendum: '\nFor cohort analysis, use a triangular matrix with cohort months as rows and periods as columns.',
  },
  {
    id: 'scenario_modeling',
    modelTier: 'opus',
    maxTokens: 8192,
    keywords: /scenario|sensitiv|what.*if|optimistic|pessimistic|base.*case/i,
    instruction: 'Add scenario analysis with Base/Optimistic/Pessimistic toggles using named ranges and SWITCH().',
    systemAddendum: '\nFor scenarios, use a single "Scenario_Toggle" named range (1=Base, 2=Optimistic, 3=Pessimistic). All scenario-dependent cells should reference this toggle via SWITCH().',
  },
  {
    id: 'kpi_dashboard',
    modelTier: 'sonnet',
    maxTokens: 4096,
    keywords: /dashboard|kpi|metric.*summary|sparkline/i,
    instruction: 'Build a KPI dashboard with key metrics, SPARKLINE charts, and conditional formatting.',
    systemAddendum: '\nFor dashboards, use SPARKLINE() for inline charts. Green for positive trends, red for negative. Group metrics by category.',
  },
  {
    id: 'investor_metrics',
    modelTier: 'sonnet',
    maxTokens: 4096,
    keywords: /investor|board.*deck|rule.*40|magic.*number|arr|mrr/i,
    instruction: 'Calculate investor-ready metrics: MRR/ARR, growth rate, burn rate, runway, Rule of 40, magic number, net dollar retention.',
    systemAddendum: '',
  },
  {
    id: 'budget_vs_actual',
    modelTier: 'sonnet',
    maxTokens: 8192,
    keywords: /budget.*vs|vs.*actual|bva|plan.*vs/i,
    instruction: 'Create a side-by-side budget vs actual comparison with $ and % variance, conditional formatting.',
    systemAddendum: '\nFor BvA, highlight favorable variances in green and unfavorable in red. Add a commentary column for top-5 variances.',
  },
  {
    id: 'formula_xray',
    modelTier: 'sonnet',
    maxTokens: 4096,
    keywords: /explain.*formula|formula.*explain|x-ray|xray|break.*down.*formula|#explain|explain.*cell|what.*does.*formula/i,
    instruction: 'Analyze the formula in the specified cell. If no cell is specified, pick the most complex formula on the active sheet. Return ONLY the formula_xray JSON — do NOT return the normal actions/response format.',
    systemAddendum: `
FORMULA X-RAY MODE — this overrides the normal action format.

Return ONLY a JSON block with this exact structure:

\`\`\`json
{
  "type": "formula_xray",
  "cell": "B14",
  "sheet": "Calculations",
  "raw_formula": "=SUMPRODUCT((Revenue!B2:B13)*(Assumptions!C2:C13))",
  "computed_value": 1250000,
  "summary": "Multiplies monthly revenue by growth rates and sums the result.",
  "components": [
    {
      "fragment": "SUMPRODUCT(...)",
      "role": "aggregation",
      "explanation": "Sums the element-wise products of two arrays"
    },
    {
      "fragment": "Revenue!B2:B13",
      "role": "crossref",
      "explanation": "Monthly revenue figures from the Revenue tab"
    },
    {
      "fragment": "Assumptions!C2:C13",
      "role": "crossref",
      "explanation": "Growth rate assumptions for each month"
    }
  ],
  "inputs": [
    { "cell": "B2:B13", "sheet": "Revenue", "label": "Monthly Revenue", "value": "[12 values]" },
    { "cell": "C2:C13", "sheet": "Assumptions", "label": "Growth Rates", "value": "[12 values]" }
  ],
  "tip": "Consider using a named range for the growth rates to make this formula easier to audit."
}
\`\`\`

Component roles (use exactly these strings):
- "logic" — IF, IFS, SWITCH, AND, OR, NOT
- "math" — SUM, AVERAGE, arithmetic operators
- "crossref" — references to other sheets (Sheet!Cell)
- "lookup" — VLOOKUP, HLOOKUP, INDEX/MATCH, XLOOKUP
- "aggregation" — SUMPRODUCT, SUMIFS, COUNTIFS, AVERAGEIFS
- "text" — CONCATENATE, LEFT, RIGHT, MID, TEXT
- "date" — DATE, EDATE, EOMONTH, YEAR, MONTH
- "error_handling" — IFERROR, IFNA, ISERROR

Edge cases:
- If the cell contains a static value (no formula): set raw_formula to null, components and inputs to empty arrays, summary to "Static value — no formula to analyze."
- If the cell is empty: set raw_formula and computed_value to null, summary to "Empty cell."
- If the formula produces an error (#REF!, #VALUE!, etc.): include the error string in computed_value and explain what went wrong in summary.
- If no cell is specified in the user's prompt: pick the most complex formula on the active sheet (deepest nesting or most references).

Do NOT include an "actions" array. Do NOT include a "response" field. Return ONLY the formula_xray JSON block.`,
  },
];

// ─── Router ──────────────────────────────────────────────────────────────────

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
        maxTokens: skill.maxTokens,
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
        maxTokens: skill.maxTokens,
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
        maxTokens: skill.maxTokens,
      };
    }
  }

  // 4. Default: general analysis (sonnet, 4K tokens)
  return {
    skillId: null,
    modelTier: 'sonnet',
    instruction: '',
    systemAddendum: '',
    maxTokens: 4096,
  };
}

/**
 * Skills.gs — Financial Skills Registry
 *
 * 10 financial skills that Crunchy Sheets can invoke. Each skill maps to
 * a specific financial analysis workflow. The backend skill-router uses
 * this registry to dispatch to the right prompt template.
 *
 * Skills are invoked either:
 *   - Automatically: the AI detects intent from the user's prompt
 *   - Manually: user selects a skill from the sidebar dropdown
 */

/**
 * The complete skill registry.
 * Each skill has an id, display name, description, and the model tier
 * it requires (sonnet = fast/cheap, opus = deep reasoning).
 */
var SKILLS = [
  {
    id: 'variance_analysis',
    name: 'Variance Analysis',
    description: 'Compare actuals to budget/forecast. Highlights key variances with drill-down explanations.',
    modelTier: 'sonnet',
    category: 'analysis'
  },
  {
    id: 'cash_flow_forecast',
    name: 'Cash Flow Forecasting',
    description: '13-week (personal) or 12-month (business) cash flow projection with scenario toggles.',
    modelTier: 'opus',
    category: 'modeling'
  },
  {
    id: 'revenue_waterfall',
    name: 'Revenue Waterfall',
    description: 'Beginning → new → expansion → churn → contraction → ending revenue bridge.',
    modelTier: 'sonnet',
    category: 'analysis'
  },
  {
    id: 'expense_categorization',
    name: 'Expense Categorization',
    description: 'Auto-categorize transactions into standard expense categories (COGS, OpEx, CapEx, etc.).',
    modelTier: 'sonnet',
    category: 'automation'
  },
  {
    id: 'unit_economics',
    name: 'Unit Economics',
    description: 'CAC, LTV, payback period, gross margin per unit. For SaaS and e-commerce.',
    modelTier: 'opus',
    category: 'analysis'
  },
  {
    id: 'cohort_analysis',
    name: 'Cohort Analysis',
    description: 'Monthly cohort retention/revenue tables with roll-forward calculations.',
    modelTier: 'opus',
    category: 'analysis'
  },
  {
    id: 'scenario_modeling',
    name: 'Scenario Modeling',
    description: 'Add base/optimistic/pessimistic scenarios with toggle switches and sensitivity tables.',
    modelTier: 'opus',
    category: 'modeling'
  },
  {
    id: 'kpi_dashboard',
    name: 'KPI Dashboard',
    description: 'Build a summary dashboard with SPARKLINE charts, conditional formatting, and key metrics.',
    modelTier: 'sonnet',
    category: 'reporting'
  },
  {
    id: 'investor_metrics',
    name: 'Investor Metrics',
    description: 'Board-ready metrics: MRR/ARR, burn rate, runway, Rule of 40, magic number.',
    modelTier: 'sonnet',
    category: 'reporting'
  },
  {
    id: 'budget_vs_actual',
    name: 'Budget vs Actual',
    description: 'Side-by-side budget vs actual with variance %, conditional formatting, and commentary.',
    modelTier: 'sonnet',
    category: 'analysis'
  },
  {
    id: 'workbook_format',
    name: 'Format & Organize',
    description: 'Full workbook housekeeping — formatting, alignment, cleanup, tab organization.',
    modelTier: 'sonnet',
    category: 'automation'
  },
  {
    id: 'formula_xray',
    name: 'Formula X-Ray',
    description: 'Break down any formula into color-coded components with plain-English explanations.',
    modelTier: 'sonnet',
    category: 'analysis'
  },
  {
    id: 'prove_it',
    name: 'Prove It',
    description: 'Build an auditable proof tab tracing every claimed number back to source cells.',
    modelTier: 'opus',
    category: 'analysis'
  },
  {
    id: 'tab_audit',
    name: 'Tab Audit',
    description: 'Identify unused, orphan, and scratch tabs. Color-code by status.',
    modelTier: 'sonnet',
    category: 'automation'
  }
];

/**
 * Get the full skill registry. Called from sidebar to populate the dropdown.
 *
 * @return {Array} All skills.
 */
function getSkillRegistry() {
  return SKILLS;
}

/**
 * Get a skill by its id.
 *
 * @param {string} skillId
 * @return {Object|null} Skill object or null.
 */
function getSkillById(skillId) {
  for (var i = 0; i < SKILLS.length; i++) {
    if (SKILLS[i].id === skillId) return SKILLS[i];
  }
  return null;
}

/**
 * Get skills by category.
 *
 * @param {string} category - One of: analysis, modeling, automation, reporting
 * @return {Array} Matching skills.
 */
function getSkillsByCategory(category) {
  return SKILLS.filter(function(s) { return s.category === category; });
}

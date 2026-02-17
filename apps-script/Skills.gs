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
    icon: '\ud83d\udcca',
    description: 'Compare actuals to budget/forecast. Highlights key variances with drill-down explanations.',
    modelTier: 'sonnet',
    category: 'analysis'
  },
  {
    id: 'cash_flow_forecast',
    name: 'Cash Flow Forecasting',
    icon: '\ud83d\udcb0',
    description: '13-week (personal) or 12-month (business) cash flow projection with scenario toggles.',
    modelTier: 'opus',
    category: 'modeling'
  },
  {
    id: 'revenue_waterfall',
    name: 'Revenue Waterfall',
    icon: '\ud83d\udcc8',
    description: 'Beginning \u2192 new \u2192 expansion \u2192 churn \u2192 contraction \u2192 ending revenue bridge.',
    modelTier: 'sonnet',
    category: 'analysis'
  },
  {
    id: 'expense_categorization',
    name: 'Expense Categorization',
    icon: '\ud83c\udff7',
    description: 'Auto-categorize transactions into standard expense categories (COGS, OpEx, CapEx, etc.).',
    modelTier: 'sonnet',
    category: 'automation'
  },
  {
    id: 'unit_economics',
    name: 'Unit Economics',
    icon: '\ud83d\udce6',
    description: 'CAC, LTV, payback period, gross margin per unit. For SaaS and e-commerce.',
    modelTier: 'opus',
    category: 'analysis'
  },
  {
    id: 'cohort_analysis',
    name: 'Cohort Analysis',
    icon: '\ud83d\udcc5',
    description: 'Monthly cohort retention/revenue tables with roll-forward calculations.',
    modelTier: 'opus',
    category: 'analysis'
  },
  {
    id: 'scenario_modeling',
    name: 'Scenario Modeling',
    icon: '\ud83d\udd04',
    description: 'Add base/optimistic/pessimistic scenarios with toggle switches and sensitivity tables.',
    modelTier: 'opus',
    category: 'modeling'
  },
  {
    id: 'kpi_dashboard',
    name: 'KPI Dashboard',
    icon: '\ud83d\udcc9',
    description: 'Build a summary dashboard with SPARKLINE charts, conditional formatting, and key metrics.',
    modelTier: 'sonnet',
    category: 'reporting'
  },
  {
    id: 'investor_metrics',
    name: 'Investor Metrics',
    icon: '\ud83c\udfe6',
    description: 'Board-ready metrics: MRR/ARR, burn rate, runway, Rule of 40, magic number.',
    modelTier: 'sonnet',
    category: 'reporting'
  },
  {
    id: 'budget_vs_actual',
    name: 'Budget vs Actual',
    icon: '\ud83d\udccb',
    description: 'Side-by-side budget vs actual with variance %, conditional formatting, and commentary.',
    modelTier: 'sonnet',
    category: 'analysis'
  },
  {
    id: 'workbook_format',
    name: 'Format & Organize',
    icon: '\ud83e\uddf9',
    description: 'Clean up formatting, headers, and layout.',
    modelTier: 'sonnet',
    category: 'automation',
    showInUI: true
  },
  {
    id: 'formula_xray',
    name: 'Explain a Formula',
    icon: '\ud83d\udd0d',
    description: 'Break down any formula in plain English.',
    modelTier: 'sonnet',
    category: 'analysis',
    showInUI: true
  },
  {
    id: 'prove_it',
    name: 'Prove It!',
    icon: '\u2705',
    description: 'Build a proof tab tracing numbers to source data.',
    modelTier: 'opus',
    category: 'analysis',
    showInUI: true
  },
  {
    id: 'tab_audit',
    name: 'Workbook Cleanup',
    icon: '\ud83d\uddc2',
    description: 'Identify unused, empty, or disconnected tabs.',
    modelTier: 'sonnet',
    category: 'automation',
    showInUI: true
  },
  {
    id: 'explain_tab',
    name: 'Explain This Tab',
    icon: '\ud83d\udccb',
    description: 'Walk through the active tab: inputs, calculations, outputs, and purpose.',
    modelTier: 'sonnet',
    category: 'analysis',
    showInUI: true
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

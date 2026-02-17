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
    id: 'workbook_format',
    modelTier: 'sonnet',
    maxTokens: 8192,
    useFullContext: true,
    keywords: /^(?!.*(?:number|date|cell)\s*format).*\b(housekeep|tidy|clean\s*up|polish|beautif|prettify|spruce\s*up|organize\s*(?:the\s*)?(?:workbook|tabs|sheets)|format\s+(?:the\s+)?(?:entire|whole|all|workbook|every)|make\s+(?:it|this)\s+(?:look\s+)?(?:nice|clean|professional|pretty|presentable)|fix\s+the\s+(?:formatting|layout))\b/i,
    instruction: 'Format and organize this workbook. Apply professional financial formatting conventions and clean up the workbook structure.',
    systemAddendum: `
WORKBOOK FORMAT & ORGANIZE MODE

You are a meticulous financial analyst tidying up a workbook. Apply professional formatting conventions and organize the workbook structure.

TWO MODES (detect from user prompt):
1. **Full Housekeeping** (default, bare "/format" or "clean up the workbook"):

   FONT COLORS (highest priority — apply to EVERY sheet before other formatting):
   Use format_range with fontColor on data ranges for every sheet:
   - Cells with role:"input" → fontColor "#082FFF" (blue)
   - Cells with role:"formula" or any formula → fontColor "#000000" (black)
   - Key model drivers — hard-coded inputs that feed multiple downstream formulas (growth rates, scenario toggles, discount rates, tax rates) → fontColor "#082FFF" + background "#FFF2CC" (yellow highlight)
   - Regular hard-coded data (table values, labels) gets blue font only
   Group adjacent same-role cells into one format_range per contiguous section. Emit font color actions FIRST in the actions array.

   STRUCTURE & LAYOUT (apply after font colors):
   - Vertical-align ALL data cells to middle using format_range with verticalAlignment: middle
   - Header rows: bold, background #e8f0fe, bottom border SOLID, freeze row 1
   - Number formats: currency "$#,##0" or "$#,##0.00", percentages "0.0%", dates "mm/dd/yy", integers "#,##0"
   - Auto-resize columns A through the last used column (skip if nearing action budget)
   - Set tab colors by type: blue (#4285f4) for data/input tabs, green (#34a853) for output/dashboard tabs, gray (#9aa0a6) for reference/lookup tabs, orange (#fa7b17) for assumption tabs
   - Organize tab order: Assumptions/Inputs first, then models (P&L, BS, CF), then outputs (Dashboard, Reports), then reference tabs last
   - Flag unused tabs (no data beyond row 1): add a note to A1 saying "This tab appears unused — consider deleting"
   - Flag ad-hoc/scratch tabs (names like "Sheet1", "Sheet2", "Copy of..."): set tab color red (#ea4335) and add note "Rename or delete this scratch tab"

2. **Targeted Mode** (user specifies scope, e.g. "just the header row", "only P&L tab"):
   - Apply only the formatting relevant to the user's request
   - Stay within the specified scope — don't touch other tabs or areas

FINANCIAL FORMATTING CONVENTIONS (non-negotiable):
| Role | Font Color | Background | Hex |
|------|-----------|------------|-----|
| Hard-coded inputs | Blue | — | #082FFF |
| Key model drivers | Blue | Yellow | #082FFF font + #FFF2CC bg |
| Formulas (all, including cross-tab) | Black | — | #000000 |

ACTION BUDGET:
- Use format_range (not format_cell) for multi-cell formatting — one action per range
- Use set_border for borders (not format_cell)
- Use auto_resize_columns instead of individual set_column_width
- Target 30-80 total actions for a full housekeeping sweep (font colors alone may use 20-40 actions)
- Font color actions take priority over column resize and tab reordering — sacrifice those if nearing budget
- If a workbook has >8 tabs, prioritize the most important tabs and note which ones you skipped
- Use move_sheet to reorder tabs, delete_sheet only for truly empty tabs (with user-visible note first via add_note)
- Use set_tab_color for visual organization

RESPONSE FORMAT:
Return the standard JSON with actions[] array. In your response text, briefly summarize what you changed and flag anything that needs the user's attention (e.g., "Sheet3 appears unused — I flagged it but didn't delete it").`,
  },
  {
    id: 'explain_tab',
    modelTier: 'sonnet',
    maxTokens: 4096,
    useFullContext: false,
    keywords: /\/explain\s+(this\s+)?tab|what.*tab.*(for|about|doing)|purpose.*tab|describe.*tab|walk\s+me\s+through\s+(this\s+)?tab/i,
    instruction: 'Explain the active tab in plain English: key inputs, calculations, outputs, and purpose.',
    systemAddendum: `
EXPLAIN TAB MODE — structured walkthrough of the active sheet.

Provide a clear, concise explanation structured as:

1. **Purpose** — What this tab does in one sentence
2. **Inputs** — Blue-font cells (role: "input") that drive calculations. List key ones with their current values
3. **Calculations** — Key formulas and what they compute. Reference specific cells
4. **Outputs** — Summary rows, totals, or key results
5. **Connections** — Cross-tab references (which other sheets feed into or consume from this tab)

Keep it concise. A CFO should read this in 30 seconds.

Return the standard JSON format with empty actions array and your explanation in the response field.`,
  },
  {
    id: 'formula_xray',
    modelTier: 'sonnet',
    maxTokens: 4096,
    useFullContext: false,
    keywords: /explain.*formula|formula.*explain|x-ray|xray|break.*down.*formula|#explain|explain.*cell|what.*does.*formula|what.*does.*this.*do|how.*does.*this.*work|what.*this.*cell|decode.*formula|walk\s+me\s+through\s+(this\s+)?formula/i,
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
  "verified": true,
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

MULTI-CELL: When analyzing a range of cells, return:
\`\`\`json
{
  "type": "formula_xray",
  "range_summary": "These cells calculate monthly revenue projections using growth rates from Assumptions.",
  "cells": [
    { "cell": "B14", "sheet": "Calculations", "raw_formula": "=...", "computed_value": 1250000, "summary": "...", "verified": true, "components": [...], "inputs": [...] },
    { "cell": "C14", "sheet": "Calculations", "raw_formula": "=...", "computed_value": 1350000, "summary": "...", "verified": true, "components": [...], "inputs": [...] }
  ]
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

DEEP TRACING: You receive the complete reference chain from BFS tracing — use it to explain how formulas build from source data. Follow the chain from target cell through intermediate formulas down to static inputs.

TIE-OUT VERIFICATION: Reconstruct the calculation from inputs. Set \`verified: true\` if the math ties out, \`verified: false\` + \`discrepancy: "..."\` if it doesn't. NEVER silently accept numbers that don't add up.

Edge cases:
- If the cell contains a static value (no formula): set raw_formula to null, components and inputs to empty arrays, summary to "Static value — no formula to analyze."
- If the cell is empty: set raw_formula and computed_value to null, summary to "Empty cell."
- If the formula produces an error (#REF!, #VALUE!, etc.): include the error string in computed_value and explain what went wrong in summary.
- If no cell is specified in the user's prompt: pick the most complex formula on the active sheet (deepest nesting or most references).

Do NOT include an "actions" array. Do NOT include a "response" field. Return ONLY the formula_xray JSON block.`,
  },
  {
    id: 'tab_audit',
    modelTier: 'sonnet',
    maxTokens: 8192,
    useFullContext: true,
    keywords: /tab.*audit|unused.*tab|orphan.*tab|dead.*tab|tab.*cleanup|clean\s*up\s*tabs|get\s*rid\s*of.*tab|remove.*unused|which\s*tabs.*used|unnecessary\s*tab|check\s+(my\s+)?tabs|workbook.*clean|clean.*workbook/i,
    instruction: 'Audit every tab in this workbook. Classify each as Connected, Isolated, Empty, or Scratch based on the cross-reference graph. Flag problematic tabs with color-coded actions.',
    systemAddendum: `
TAB AUDIT MODE — identify unused, orphan, and scratch tabs.

You will receive a cross-reference graph in the user message under "## Cross-Reference Graph". This graph was built by scanning ALL formulas across ALL sheets (including hidden ones), so it captures every cross-sheet reference — not just what's visible in bookend summaries.

If no cross-reference graph is present, respond: "Tab audit requires a cross-reference graph — please try again."

CLASSIFICATION (4 categories):
1. **Connected** — has inbound refs (another sheet references it) OR outbound refs (it references another sheet). These are part of the model. No action needed.
2. **Isolated** — has data (dataRows > 0, isEmpty = false), but zero inbound AND zero outbound refs. Orphan tab — not connected to anything. Action: set_tab_color orange (#fa7b17) + add_note on A1 explaining it's isolated.
3. **Empty** — zero data rows (isEmpty = true). Action: set_tab_color red (#ea4335) + add_note on A1 + delete_sheet.
4. **Scratch** — name matches scratch pattern (Sheet1, Sheet2, Copy of..., test, temp) regardless of data content. Action: set_tab_color red (#ea4335) + add_note on A1 suggesting rename or delete.

Note: A sheet can be both Scratch AND (Empty or Isolated). Scratch takes priority in classification.

INBOUND REFS: Sheet X has inbound refs if ANY other sheet's refs[] array includes X.
OUTBOUND REFS: Sheet X has outbound refs if its own refs[] array is non-empty.

HIDDEN SHEETS: Sheets with isHidden=true appear in the graph but NOT in the workbook state. Include them in the audit table with a "(hidden)" note.

RESPONSE FORMAT:
1. Markdown table: Tab Name | Status | Reason (one row per sheet)
2. Summary line: "X of Y tabs flagged (Z connected, ...)"
3. If any sheet has hasIndirect=true, add warning: "⚠ Some tabs use INDIRECT() — dynamic references can't be statically traced. Review these manually."
4. Tab color legend: Connected = no change, Isolated = orange, Empty = red (deleted), Scratch = red
5. Max 3 actions per flagged tab (set_tab_color + add_note + optionally delete_sheet for empty)

Return the standard JSON with actions[] array, response text, and summary.`,
  },
  {
    id: 'prove_it',
    modelTier: 'opus',
    maxTokens: 12288,
    useFullContext: true,
    keywords: /prove\s+it|show\s+(me\s+)?your\s+work|back\s+it\s+up|prove\s+(that|this|the\s+numbers)|create\s+.*proof|verify\s+(that|this|the)|workpaper|work\s*paper|source\s+check|check\s+(your|the)\s+(math|numbers)/i,
    instruction: 'Build a proof tab that verifies your previous analysis. Create a sheet with formulas tracing every key number back to source cells. The proof must be auditable — every number from the workbook is a formula, never hardcoded.',
    systemAddendum: `
PROVE IT MODE — build an auditable proof tab.

The user's prompt contains their previous AI response wrapped in [Previous AI Response]...[/Previous AI Response]. Parse it to identify every specific number, percentage, or calculation you claimed. Each one needs a proof row.

If no [Previous AI Response] block exists, respond: "Nothing to verify yet — ask me a question first, then say 'prove it' to see the math."

BUILD THE PROOF TAB:
1. Create a sheet via add_sheet named "Proof: {Short Topic}" (max 30 chars) with tabColor "#1e8e3e"
2. Structure it clearly: labeled source values (as cross-tab formulas like ='P&L'!B14), derivation steps, and results
3. Row 1 should be a bold header row. Use freeze_rows to keep it visible.
4. Use set_column_width to make label columns wide enough to read (200px+)
5. Color-code with format_cell: blue font (#082FFF) for hard-coded inputs, black for all formulas (including cross-tab refs). Key model drivers get yellow background (#FFF2CC) + blue font (#082FFF)
6. Header row background: #e8f0fe, bold
7. ALWAYS end with an activate_sheet action so the user lands on the proof tab after Apply

RULES:
- Max 30 data rows (focus on the most significant claims)
- Every value that exists in the workbook MUST be a cross-tab formula reference, never hardcoded
- If a number cannot be traced to a cell (not in workbook), prefix the label with "[Manual]" and use blue (#082FFF) font
- Tab name must start with "Proof: "
- The proof must be self-contained — anyone should be able to click through formulas to verify`,
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
        useFullContext: skill.useFullContext,
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
        useFullContext: skill.useFullContext,
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
        useFullContext: skill.useFullContext,
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

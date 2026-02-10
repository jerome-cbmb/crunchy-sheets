// ─── Cell Actions ──────────────────────────────────────────────────────────

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

// ─── Skill Router ──────────────────────────────────────────────────────────

export interface SkillContext {
  skillId: string | null;
  modelTier: 'sonnet' | 'opus';
  instruction: string;
  systemAddendum: string;
  maxTokens: number;
}

export interface SkillDefinition {
  id: string;
  modelTier: 'sonnet' | 'opus';
  maxTokens: number;
  keywords: RegExp;
  instruction: string;
  systemAddendum: string;
}

// ─── Request / Response ────────────────────────────────────────────────────

export interface AnalyzeRequest {
  workbookState: any;
  prompt: string;
  skill?: string;
  spreadsheetId: string;
  userEmail: string;
  userRole?: string;
}

export interface AnalyzeResponse {
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

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface GoogleUser {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

// ─── Formula X-Ray ─────────────────────────────────────────────────────────

export interface FormulaXrayComponent {
  fragment: string;
  role: 'logic' | 'math' | 'crossref' | 'lookup' | 'aggregation' | 'text' | 'date' | 'error_handling';
  explanation: string;
}

export interface FormulaXrayInput {
  cell: string;
  sheet: string;
  label: string;
  value: any;
}

export interface FormulaXrayData {
  type: 'formula_xray';
  cell: string;
  sheet: string;
  raw_formula: string | null;
  computed_value: any;
  summary: string;
  components: FormulaXrayComponent[];
  inputs: FormulaXrayInput[];
  tip?: string;
}

export interface ParsedResponse {
  actions: CellAction[];
  response: string;
  summary?: string;
  rawText: string;
  parseErrors?: string[];
  formulaXray?: FormulaXrayData;
}

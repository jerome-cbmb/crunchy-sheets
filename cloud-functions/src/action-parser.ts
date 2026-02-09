/**
 * action-parser.ts — Parse Structured Actions from Claude Responses
 *
 * Claude returns a JSON block with structured actions that Sheets can execute.
 * Example:
 *
 * ```json
 * {
 *   "actions": [
 *     { "type": "set_formula", "sheet": "Calculations", "cell": "B14", "formula": "=B3*(1+B4)" },
 *     { "type": "format_cell", "sheet": "Calculations", "cell": "B14", "format": { "fontColor": "#000000" } },
 *     { "type": "set_value", "sheet": "Assumptions", "cell": "A1", "value": "Revenue Growth" }
 *   ],
 *   "response": "I've set up the revenue calculation...",
 *   "summary": "Created growth formula with input labels"
 * }
 * ```
 */

import { CellAction } from './analyze';

export interface ParsedResponse {
  actions: CellAction[];
  response: string;
  summary?: string;
  rawText: string;
  parseErrors?: string[];
}

/**
 * Extract JSON from Claude's response and parse actions.
 * Claude wraps JSON in ```json...``` code block.
 *
 * @param claudeText - The raw text response from Claude
 * @returns Parsed actions and response text
 */
export function parseClaudeResponse(claudeText: string): ParsedResponse {
  const parseErrors: string[] = [];

  // Try to find a JSON code block
  const jsonMatch = claudeText.match(/```(?:json)?\s*([\s\S]*?)```/);
  let jsonText: string | null = null;

  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  } else {
    // Fallback: try to parse raw text if it looks like JSON
    const trimmed = claudeText.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      jsonText = trimmed;
    }
  }

  let parsedJson: any = null;
  if (jsonText) {
    try {
      parsedJson = JSON.parse(jsonText);
    } catch (e) {
      parseErrors.push(`Failed to parse JSON: ${e}`);
    }
  }

  // Extract the fields
  const actions: CellAction[] = [];
  let response = claudeText;
  let summary: string | undefined;

  if (parsedJson) {
    // Validate and extract actions
    if (Array.isArray(parsedJson.actions)) {
      for (const action of parsedJson.actions) {
        const validated = validateAction(action);
        if (validated.valid) {
          actions.push(validated.action!);
        } else {
          parseErrors.push(validated.error!);
        }
      }
    } else if (parsedJson.actions) {
      parseErrors.push('actions field is not an array');
    }

    // Extract response text if provided
    if (typeof parsedJson.response === 'string') {
      response = parsedJson.response;
    }

    // Extract summary if provided
    if (typeof parsedJson.summary === 'string') {
      summary = parsedJson.summary;
    }
  }

  return {
    actions,
    response,
    summary,
    rawText: claudeText,
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
  };
}

/**
 * Validate a single action object.
 */
interface ValidationResult {
  valid: boolean;
  action?: CellAction;
  error?: string;
}

function validateAction(action: any): ValidationResult {
  if (!action || typeof action !== 'object') {
    return { valid: false, error: 'Action is not an object' };
  }

  const type = action.type;
  if (!type || !['set_value', 'set_formula', 'format_cell', 'add_sheet', 'rename_sheet', 'add_named_range'].includes(type)) {
    return { valid: false, error: `Invalid action type: ${type}` };
  }

  // Type-specific validation
  switch (type) {
    case 'set_value':
    case 'set_formula':
      if (!action.sheet || !action.cell) {
        return { valid: false, error: `${type} requires sheet and cell` };
      }
      if (type === 'set_formula' && !action.formula) {
        return { valid: false, error: 'set_formula requires formula field' };
      }
      if (type === 'set_value' && action.value === undefined) {
        return { valid: false, error: 'set_value requires value field' };
      }
      break;

    case 'format_cell':
      if (!action.sheet || !action.cell) {
        return { valid: false, error: 'format_cell requires sheet and cell' };
      }
      if (!action.format || typeof action.format !== 'object') {
        return { valid: false, error: 'format_cell requires format object' };
      }
      break;

    case 'add_sheet':
      if (!action.sheetName) {
        return { valid: false, error: 'add_sheet requires sheetName' };
      }
      break;

    case 'rename_sheet':
      if (!action.sheet || !action.sheetName) {
        return { valid: false, error: 'rename_sheet requires sheet and sheetName' };
      }
      break;

    case 'add_named_range':
      if (!action.rangeName || !action.rangeA1) {
        return { valid: false, error: 'add_named_range requires rangeName and rangeA1' };
      }
      break;
  }

  return { valid: true, action };
}

/**
 * Build the system prompt instruction for Claude to return structured actions.
 */
export function buildActionInstructions(): string {
  return `
When you modify a workbook, return your response as a JSON object with this structure:

\`\`\`json
{
  "actions": [
    { "type": "set_value", "sheet": "SheetName", "cell": "A1", "value": "Revenue" },
    { "type": "set_formula", "sheet": "SheetName", "cell": "A2", "formula": "=A1*1.1" },
    { "type": "format_cell", "sheet": "SheetName", "cell": "A1", "format": { "fontColor": "#0000FF", "bold": true } },
    { "type": "add_sheet", "sheetName": "Dashboard" },
    { "type": "add_named_range", "rangeName": "Revenue_Growth", "rangeA1": "Assumptions!B5" }
  ],
  "response": "I've set up the revenue forecast with growth rate input...",
  "summary": "Created Assumptions sheet with 5 key inputs"
}
\`\`\`

**Important:**
- Always include the JSON block, even for analysis-only requests.
- For analysis, use an empty actions array: \`"actions": []\`
- Sheet names must match exactly (case-sensitive).
- Cell references are A1 notation (e.g., "B14", not "B14:B14").
- Use actual hex color codes (e.g., "#0000FF" for blue).
- For formulas, ensure they reference the correct sheets.
`;
}

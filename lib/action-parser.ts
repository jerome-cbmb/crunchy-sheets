import { CellAction, FormulaXrayData, ParsedResponse } from './types';

/**
 * Extract JSON from Claude's response and parse actions.
 * Claude wraps JSON in ```json...``` code block.
 */
export function parseClaudeResponse(claudeText: string): ParsedResponse {
  const parseErrors: string[] = [];

  const jsonMatch = claudeText.match(/```(?:json)?\s*([\s\S]*?)```/);
  let jsonText: string | null = null;

  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  } else {
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

  // Formula X-Ray early return
  if (parsedJson && parsedJson.type === 'formula_xray') {
    return {
      actions: [],
      response: parsedJson.summary || '',
      rawText: claudeText,
      formulaXray: parsedJson as FormulaXrayData,
    };
  }

  const actions: CellAction[] = [];
  let response = claudeText;
  let summary: string | undefined;

  if (parsedJson) {
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

    if (typeof parsedJson.response === 'string') {
      response = parsedJson.response;
    }

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
  if (!type || !['set_value', 'set_formula', 'format_cell', 'add_sheet', 'rename_sheet', 'add_named_range', 'activate_sheet', 'set_column_width', 'freeze_rows', 'freeze_cols', 'format_range', 'set_border', 'auto_resize_columns', 'delete_sheet', 'set_tab_color', 'add_note', 'move_sheet'].includes(type)) {
    return { valid: false, error: `Invalid action type: ${type}` };
  }

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

    case 'activate_sheet':
      if (!action.sheet) {
        return { valid: false, error: 'activate_sheet requires sheet' };
      }
      break;

    case 'set_column_width':
      if (!action.sheet || !action.column || !action.width) {
        return { valid: false, error: 'set_column_width requires sheet, column, and width' };
      }
      break;

    case 'freeze_rows':
      if (!action.sheet || !action.rows) {
        return { valid: false, error: 'freeze_rows requires sheet and rows' };
      }
      break;

    case 'freeze_cols':
      if (!action.sheet || !action.columns) {
        return { valid: false, error: 'freeze_cols requires sheet and columns' };
      }
      break;

    case 'format_range':
      if (!action.sheet || !action.range) {
        return { valid: false, error: 'format_range requires sheet and range' };
      }
      if (!action.format || typeof action.format !== 'object') {
        return { valid: false, error: 'format_range requires format object' };
      }
      break;

    case 'set_border':
      if (!action.sheet || !action.range) {
        return { valid: false, error: 'set_border requires sheet and range' };
      }
      break;

    case 'auto_resize_columns':
      if (!action.sheet || !action.startColumn || !action.endColumn) {
        return { valid: false, error: 'auto_resize_columns requires sheet, startColumn, and endColumn' };
      }
      break;

    case 'delete_sheet':
      if (!action.sheet) {
        return { valid: false, error: 'delete_sheet requires sheet' };
      }
      break;

    case 'set_tab_color':
      if (!action.sheet || !action.color) {
        return { valid: false, error: 'set_tab_color requires sheet and color' };
      }
      break;

    case 'add_note':
      if (!action.sheet || !action.cell || !action.note) {
        return { valid: false, error: 'add_note requires sheet, cell, and note' };
      }
      break;

    case 'move_sheet':
      if (!action.sheet || action.position == null) {
        return { valid: false, error: 'move_sheet requires sheet and position' };
      }
      break;
  }

  return { valid: true, action };
}

export function buildActionInstructions(): string {
  return `
When you modify a workbook, return your response as a JSON object with this structure:

\`\`\`json
{
  "actions": [
    { "type": "set_value", "sheet": "SheetName", "cell": "A1", "value": "Revenue" },
    { "type": "set_formula", "sheet": "SheetName", "cell": "A2", "formula": "=A1*1.1" },
    { "type": "format_cell", "sheet": "SheetName", "cell": "A1", "format": { "fontColor": "#082FFF", "bold": true } },
    { "type": "add_sheet", "sheetName": "Dashboard", "tabColor": "#1e8e3e" },
    { "type": "add_named_range", "rangeName": "Revenue_Growth", "rangeA1": "Assumptions!B5" },
    { "type": "activate_sheet", "sheet": "Dashboard" },
    { "type": "set_column_width", "sheet": "Dashboard", "column": "A", "width": 200 },
    { "type": "freeze_rows", "sheet": "Dashboard", "rows": 1 },
    { "type": "freeze_cols", "sheet": "Dashboard", "columns": 1 },
    { "type": "format_range", "sheet": "P&L", "range": "B2:H50", "format": { "fontColor": "#000000", "verticalAlignment": "middle" } },
    { "type": "format_range", "sheet": "P&L", "range": "A1:H1", "format": { "bold": true, "background": "#e8f0fe", "wrapStrategy": "WRAP" } },
    { "type": "set_border", "sheet": "P&L", "range": "A1:H1", "bottom": true, "style": "SOLID", "color": "#000000" },
    { "type": "auto_resize_columns", "sheet": "P&L", "startColumn": "A", "endColumn": "H" },
    { "type": "delete_sheet", "sheet": "Sheet3" },
    { "type": "set_tab_color", "sheet": "Assumptions", "color": "#4285f4" },
    { "type": "add_note", "sheet": "Assumptions", "cell": "B3", "note": "Key growth driver" },
    { "type": "move_sheet", "sheet": "Dashboard", "position": 1 }
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

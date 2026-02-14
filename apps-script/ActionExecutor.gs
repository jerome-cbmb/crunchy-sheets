/**
 * ActionExecutor.gs — Execute CellAction Arrays Against the Active Spreadsheet
 *
 * Takes an array of CellAction objects returned by Claude (via the backend)
 * and applies them to the active spreadsheet. Each action is independently
 * try/caught so one failure doesn't stop the batch.
 *
 * CellAction types:
 *   - set_value:       Set a cell's value (string, number, boolean)
 *   - set_formula:     Set a cell's formula (must start with '=')
 *   - format_cell:     Apply formatting (color, bold, numberFormat, etc.)
 *   - add_sheet:       Create a new sheet (skip if it already exists)
 *   - rename_sheet:    Rename an existing sheet
 *   - add_named_range: Create a named range
 *
 * Financial formatting conventions:
 *   Blue (#082FFF)  → hard-coded inputs
 *   Blue (#082FFF) + Yellow bg (#FFF2CC) → key model drivers
 *   Black (#000000) → formulas (all, including cross-tab references)
 */

/**
 * Main entry point. Executes an array of CellAction objects.
 *
 * @param {Array} actions - Array of CellAction objects from the backend.
 * @return {Object} Result summary: { applied, skipped, errors }
 */
function executeActions(actions) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var applied = 0;
  var skipped = 0;
  var errors = [];
  var skipReasons = [];

  if (!actions || !Array.isArray(actions)) {
    return { applied: 0, skipped: 0, errors: ['No valid actions array provided'], skipReasons: [] };
  }

  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    try {
      var result = _executeSingleAction(ss, action, i);
      if (result.skipped) {
        skipped++;
        if (result.reason) skipReasons.push(result.reason);
        Logger.log('[ActionExecutor] Skipped action ' + i + ': ' + result.reason);
      } else {
        applied++;
        Logger.log('[ActionExecutor] Applied action ' + i + ': ' + _describeAction(action));
      }
    } catch (e) {
      errors.push('Action ' + i + ' (' + (action.type || 'unknown') + '): ' + e.message);
      Logger.log('[ActionExecutor] Error on action ' + i + ': ' + e.message);
    }
  }

  Logger.log('[ActionExecutor] Complete — applied: ' + applied + ', skipped: ' + skipped + ', errors: ' + errors.length);

  return {
    applied: applied,
    skipped: skipped,
    errors: errors,
    skipReasons: skipReasons
  };
}

// ─── Single Action Dispatch ──────────────────────────────────────────────────

/**
 * Execute a single action against the spreadsheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Active spreadsheet.
 * @param {Object} action - A single CellAction object.
 * @param {number} index - Index in the batch (for logging).
 * @return {Object} { skipped: boolean, reason?: string }
 */
function _executeSingleAction(ss, action, index) {
  switch (action.type) {
    case 'set_value':
      return _execSetValue(ss, action);

    case 'set_formula':
      return _execSetFormula(ss, action);

    case 'format_cell':
      return _execFormatCell(ss, action);

    case 'add_sheet':
      return _execAddSheet(ss, action);

    case 'rename_sheet':
      return _execRenameSheet(ss, action);

    case 'add_named_range':
      return _execAddNamedRange(ss, action);

    case 'activate_sheet':
      return _execActivateSheet(ss, action);

    case 'set_column_width':
      return _execSetColumnWidth(ss, action);

    case 'freeze_rows':
      return _execFreezeRows(ss, action);

    case 'freeze_cols':
      return _execFreezeCols(ss, action);

    case 'format_range':
      return _execFormatRange(ss, action);

    case 'set_border':
      return _execSetBorder(ss, action);

    case 'auto_resize_columns':
      return _execAutoResizeColumns(ss, action);

    case 'delete_sheet':
      return _execDeleteSheet(ss, action);

    case 'set_tab_color':
      return _execSetTabColor(ss, action);

    case 'add_note':
      return _execAddNote(ss, action);

    case 'move_sheet':
      return _execMoveSheet(ss, action);

    default:
      throw new Error('Unknown action type: ' + action.type);
  }
}

// ─── Action Handlers ─────────────────────────────────────────────────────────

/**
 * set_value — Set a cell's value (string, number, or boolean).
 * Expected fields: { type, sheet, cell, value }
 */
function _execSetValue(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  var range = sheet.getRange(action.cell);
  var val = action.value;

  // Coerce types if needed
  if (typeof val === 'string') {
    // Check if it's a number in string form
    var numVal = Number(val);
    if (val !== '' && !isNaN(numVal)) {
      val = numVal;
    }
    // Check for booleans
    else if (val.toLowerCase() === 'true') {
      val = true;
    } else if (val.toLowerCase() === 'false') {
      val = false;
    }
  }

  range.setValue(val);
  return { skipped: false };
}

/**
 * set_formula — Set a cell's formula. Must start with '='.
 * Expected fields: { type, sheet, cell, formula }
 */
function _execSetFormula(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  var range = sheet.getRange(action.cell);
  var formula = action.formula;

  // Validate that it starts with '='
  if (!formula || formula.charAt(0) !== '=') {
    throw new Error('Formula must start with "=": got "' + (formula || '') + '"');
  }

  range.setFormula(formula);
  return { skipped: false };
}

/**
 * format_cell — Apply formatting to a cell.
 * Expected fields: { type, sheet, cell, format }
 * Supported format properties:
 *   fontColor, background/backgroundColor, bold, italic, fontSize, numberFormat
 */
function _execFormatCell(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  var range = sheet.getRange(action.cell);
  var fmt = action.format;

  if (!fmt || typeof fmt !== 'object') {
    throw new Error('format_cell requires a format object');
  }

  // Font color
  if (fmt.fontColor) {
    range.setFontColor(fmt.fontColor);
  }

  // Background color (accept both 'background' and 'backgroundColor')
  var bgColor = fmt.background || fmt.backgroundColor;
  if (bgColor) {
    range.setBackground(bgColor);
  }

  // Bold
  if (fmt.bold !== undefined) {
    range.setFontWeight(fmt.bold ? 'bold' : 'normal');
  }

  // Italic
  if (fmt.italic !== undefined) {
    range.setFontStyle(fmt.italic ? 'italic' : 'normal');
  }

  // Font size
  if (fmt.fontSize !== undefined) {
    range.setFontSize(fmt.fontSize);
  }

  // Number format (e.g., "#,##0.00", "$#,##0", "0.0%")
  if (fmt.numberFormat) {
    range.setNumberFormat(fmt.numberFormat);
  }

  return { skipped: false };
}

/**
 * add_sheet — Create a new sheet. Skips if a sheet with the name already exists.
 * Expected fields: { type, sheetName }
 */
function _execAddSheet(ss, action) {
  var name = action.sheetName;
  if (!name) {
    throw new Error('add_sheet requires sheetName');
  }

  // Check if sheet already exists
  var existing = ss.getSheetByName(name);
  if (existing) {
    return { skipped: true, reason: 'Sheet "' + name + '" already exists' };
  }

  // Proof tab limit: max 5 tabs starting with "Proof: "
  if (name.indexOf('Proof: ') === 0) {
    var sheets = ss.getSheets();
    var proofCount = 0;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().indexOf('Proof: ') === 0) proofCount++;
    }
    if (proofCount >= 5) {
      return { skipped: true, reason: 'Proof tab limit reached (max 5). Delete an existing Proof tab first.' };
    }
  }

  var newSheet = ss.insertSheet(name);

  // Apply tab color if specified
  if (action.tabColor) {
    newSheet.setTabColor(action.tabColor);
  }

  return { skipped: false };
}

/**
 * rename_sheet — Rename an existing sheet.
 * Expected fields: { type, sheet (current name), sheetName (new name) }
 */
function _execRenameSheet(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  var newName = action.sheetName;

  if (!newName) {
    throw new Error('rename_sheet requires sheetName (new name)');
  }

  // Check if target name is already taken
  var conflict = ss.getSheetByName(newName);
  if (conflict) {
    return { skipped: true, reason: 'Cannot rename: sheet "' + newName + '" already exists' };
  }

  sheet.setName(newName);
  return { skipped: false };
}

/**
 * add_named_range — Create a named range.
 * Expected fields: { type, rangeName, rangeA1 }
 * rangeA1 can include sheet reference: "Assumptions!B5" or "Assumptions!B5:B10"
 */
function _execAddNamedRange(ss, action) {
  var name = action.rangeName;
  var a1 = action.rangeA1;

  if (!name || !a1) {
    throw new Error('add_named_range requires rangeName and rangeA1');
  }

  // Parse rangeA1 — may include sheet name (e.g., "Assumptions!B5")
  var range;
  if (a1.indexOf('!') !== -1) {
    var parts = a1.split('!');
    var sheetName = parts[0].replace(/'/g, ''); // Strip quotes around sheet names
    var cellRef = parts[1];
    var sheet = _getSheet(ss, sheetName);
    range = sheet.getRange(cellRef);
  } else {
    // Default to active sheet
    range = ss.getActiveSheet().getRange(a1);
  }

  // Remove existing named range with the same name (if any) to avoid duplicates
  var existing = ss.getNamedRanges();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getName() === name) {
      existing[i].remove();
      break;
    }
  }

  ss.setNamedRange(name, range);
  return { skipped: false };
}

/**
 * activate_sheet — Switch the active sheet so the user lands on it after Apply.
 * Expected fields: { type, sheet }
 */
function _execActivateSheet(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  ss.setActiveSheet(sheet);
  return { skipped: false };
}

/**
 * set_column_width — Set a column's width in pixels.
 * Expected fields: { type, sheet, column, width }
 */
function _execSetColumnWidth(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  var colNum = _colLetterToNum(action.column);
  sheet.setColumnWidth(colNum, action.width);
  return { skipped: false };
}

/**
 * freeze_rows — Freeze the top N rows on a sheet.
 * Expected fields: { type, sheet, rows }
 */
function _execFreezeRows(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  sheet.setFrozenRows(action.rows);
  return { skipped: false };
}

/**
 * freeze_cols — Freeze the first N columns on a sheet.
 * Expected fields: { type, sheet, columns }
 */
function _execFreezeCols(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  sheet.setFrozenColumns(action.columns);
  return { skipped: false };
}

/**
 * format_range — Apply formatting to a range of cells.
 * Expected fields: { type, sheet, range, format }
 * Supported format properties:
 *   fontColor, background/backgroundColor, bold, italic, fontSize,
 *   numberFormat, horizontalAlignment, verticalAlignment, wrapStrategy
 */
function _execFormatRange(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  var range = sheet.getRange(action.range);
  var fmt = action.format;

  if (!fmt || typeof fmt !== 'object') {
    throw new Error('format_range requires a format object');
  }

  if (fmt.fontColor) {
    range.setFontColor(fmt.fontColor);
  }

  var bgColor = fmt.background || fmt.backgroundColor;
  if (bgColor) {
    range.setBackground(bgColor);
  }

  if (fmt.bold !== undefined) {
    range.setFontWeight(fmt.bold ? 'bold' : 'normal');
  }

  if (fmt.italic !== undefined) {
    range.setFontStyle(fmt.italic ? 'italic' : 'normal');
  }

  if (fmt.fontSize !== undefined) {
    range.setFontSize(fmt.fontSize);
  }

  if (fmt.numberFormat) {
    range.setNumberFormat(fmt.numberFormat);
  }

  if (fmt.horizontalAlignment) {
    range.setHorizontalAlignment(fmt.horizontalAlignment);
  }

  if (fmt.verticalAlignment) {
    range.setVerticalAlignment(fmt.verticalAlignment);
  }

  if (fmt.wrapStrategy) {
    range.setWrapStrategy(SpreadsheetApp.WrapStrategy[fmt.wrapStrategy]);
  }

  return { skipped: false };
}

/**
 * set_border — Apply borders to a range.
 * Expected fields: { type, sheet, range, top?, bottom?, left?, right?, vertical?, horizontal?, style?, color? }
 * Unspecified sides are passed as null (preserving existing borders).
 */
function _execSetBorder(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  var range = sheet.getRange(action.range);

  var style = action.style ? SpreadsheetApp.BorderStyle[action.style] : SpreadsheetApp.BorderStyle.SOLID;
  var color = action.color || '#000000';

  range.setBorder(
    action.top != null ? action.top : null,
    action.left != null ? action.left : null,
    action.bottom != null ? action.bottom : null,
    action.right != null ? action.right : null,
    action.vertical != null ? action.vertical : null,
    action.horizontal != null ? action.horizontal : null,
    color,
    style
  );

  return { skipped: false };
}

/**
 * auto_resize_columns — Auto-resize a range of columns to fit content.
 * Expected fields: { type, sheet, startColumn, endColumn }
 */
function _execAutoResizeColumns(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  var startCol = _colLetterToNum(action.startColumn);
  var endCol = _colLetterToNum(action.endColumn);
  var numCols = endCol - startCol + 1;
  sheet.autoResizeColumns(startCol, numCols);
  return { skipped: false };
}

/**
 * delete_sheet — Delete a sheet from the workbook.
 * Safety: skips if it's the last sheet or the active sheet.
 * Expected fields: { type, sheet }
 */
function _execDeleteSheet(ss, action) {
  var sheet = _getSheet(ss, action.sheet);

  // Safety: don't delete the last sheet
  if (ss.getSheets().length <= 1) {
    return { skipped: true, reason: 'Cannot delete the only remaining sheet' };
  }

  // Safety: don't delete the active sheet
  if (sheet.getName() === ss.getActiveSheet().getName()) {
    return { skipped: true, reason: 'Cannot delete the active sheet "' + action.sheet + '"' };
  }

  ss.deleteSheet(sheet);
  return { skipped: false };
}

/**
 * set_tab_color — Set a sheet's tab color.
 * Expected fields: { type, sheet, color }
 */
function _execSetTabColor(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  sheet.setTabColor(action.color);
  return { skipped: false };
}

/**
 * add_note — Add a note to a cell.
 * Expected fields: { type, sheet, cell, note }
 */
function _execAddNote(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  sheet.getRange(action.cell).setNote(action.note);
  return { skipped: false };
}

/**
 * move_sheet — Move a sheet to a specific position (1-indexed).
 * Expected fields: { type, sheet, position }
 */
function _execMoveSheet(ss, action) {
  var sheet = _getSheet(ss, action.sheet);
  sheet.activate();
  ss.moveActiveSheet(action.position);
  return { skipped: false };
}

/**
 * Convert column letter(s) to a 1-based column number.
 * A=1, Z=26, AA=27, AZ=52, etc.
 */
function _colLetterToNum(col) {
  if (!col || typeof col !== 'string') {
    throw new Error('Column letter is required');
  }
  col = col.toUpperCase();
  var num = 0;
  for (var i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get a sheet by name, with a clear error if it doesn't exist.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function _getSheet(ss, sheetName) {
  if (!sheetName) {
    throw new Error('Sheet name is required but was not provided');
  }

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet "' + sheetName + '" not found in workbook');
  }

  return sheet;
}

/**
 * Build a human-readable description of an action for logging and UI previews.
 *
 * @param {Object} action - A CellAction object.
 * @return {string} Short description.
 */
function _describeAction(action) {
  switch (action.type) {
    case 'set_value':
      var displayVal = _truncate(String(action.value), 30);
      return 'Set ' + action.cell + ' = "' + displayVal + '" on ' + action.sheet;

    case 'set_formula':
      var displayFormula = _truncate(action.formula, 40);
      return 'Set ' + action.cell + ' = ' + displayFormula + ' on ' + action.sheet;

    case 'format_cell':
      var fmtParts = [];
      var fmt = action.format || {};
      if (fmt.fontColor) fmtParts.push('color: ' + fmt.fontColor);
      if (fmt.bold) fmtParts.push('bold');
      if (fmt.italic) fmtParts.push('italic');
      if (fmt.numberFormat) fmtParts.push('format: ' + fmt.numberFormat);
      if (fmt.background || fmt.backgroundColor) fmtParts.push('bg: ' + (fmt.background || fmt.backgroundColor));
      if (fmt.fontSize) fmtParts.push('size: ' + fmt.fontSize);
      return 'Format ' + action.cell + ' on ' + action.sheet + ' (' + fmtParts.join(', ') + ')';

    case 'add_sheet':
      return 'Add sheet "' + action.sheetName + '"';

    case 'rename_sheet':
      return 'Rename sheet "' + action.sheet + '" → "' + action.sheetName + '"';

    case 'add_named_range':
      return 'Named range "' + action.rangeName + '" → ' + action.rangeA1;

    case 'activate_sheet':
      return 'Switch to sheet "' + action.sheet + '"';

    case 'set_column_width':
      return 'Set column ' + action.column + ' width to ' + action.width + 'px on ' + action.sheet;

    case 'freeze_rows':
      return 'Freeze top ' + action.rows + ' row' + (action.rows !== 1 ? 's' : '') + ' on ' + action.sheet;

    case 'freeze_cols':
      return 'Freeze first ' + action.columns + ' column' + (action.columns !== 1 ? 's' : '') + ' on ' + action.sheet;

    case 'format_range':
      var fmtParts2 = [];
      var fmt2 = action.format || {};
      if (fmt2.fontColor) fmtParts2.push('color: ' + fmt2.fontColor);
      if (fmt2.bold) fmtParts2.push('bold');
      if (fmt2.italic) fmtParts2.push('italic');
      if (fmt2.numberFormat) fmtParts2.push('format: ' + fmt2.numberFormat);
      if (fmt2.background || fmt2.backgroundColor) fmtParts2.push('bg: ' + (fmt2.background || fmt2.backgroundColor));
      if (fmt2.fontSize) fmtParts2.push('size: ' + fmt2.fontSize);
      if (fmt2.verticalAlignment) fmtParts2.push('vAlign: ' + fmt2.verticalAlignment);
      if (fmt2.horizontalAlignment) fmtParts2.push('hAlign: ' + fmt2.horizontalAlignment);
      if (fmt2.wrapStrategy) fmtParts2.push('wrap: ' + fmt2.wrapStrategy);
      return 'Format ' + action.range + ' on ' + action.sheet + ' (' + fmtParts2.join(', ') + ')';

    case 'set_border':
      var sides = [];
      if (action.top) sides.push('top');
      if (action.bottom) sides.push('bottom');
      if (action.left) sides.push('left');
      if (action.right) sides.push('right');
      if (action.vertical) sides.push('vertical');
      if (action.horizontal) sides.push('horizontal');
      return 'Border ' + action.range + ' on ' + action.sheet + ' (' + (sides.join(', ') || 'all') + ', ' + (action.style || 'SOLID') + ')';

    case 'auto_resize_columns':
      return 'Auto-resize columns ' + action.startColumn + '–' + action.endColumn + ' on ' + action.sheet;

    case 'delete_sheet':
      return 'Delete sheet "' + action.sheet + '"';

    case 'set_tab_color':
      return 'Set tab color of "' + action.sheet + '" to ' + action.color;

    case 'add_note':
      var notePreview = _truncate(action.note, 30);
      return 'Note on ' + action.cell + ' on ' + action.sheet + ': "' + notePreview + '"';

    case 'move_sheet':
      return 'Move "' + action.sheet + '" to position ' + action.position;

    default:
      return action.type + ' (unknown)';
  }
}

/**
 * Describe an action array for the sidebar preview.
 * Returns an array of human-readable strings.
 *
 * @param {Array} actions - Array of CellAction objects.
 * @return {Array} Array of description strings.
 */
function describeActions(actions) {
  if (!actions || !Array.isArray(actions)) return [];
  var descriptions = [];
  for (var i = 0; i < actions.length; i++) {
    descriptions.push(_describeAction(actions[i]));
  }
  return descriptions;
}

/**
 * Truncate a string to a max length, adding "…" if truncated.
 *
 * @param {string} str
 * @param {number} maxLen
 * @return {string}
 */
function _truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 1) + '…';
}

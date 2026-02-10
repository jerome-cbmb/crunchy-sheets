/**
 * WorkbookState.gs — Workbook State Serialization (RLM Approach)
 *
 * Captures the complete structural representation of the active workbook:
 *   - Sheet names, dimensions, types
 *   - Cell values AND formulas (separate layers)
 *   - Formatting (font colors → input/formula/cross-ref detection)
 *   - Named ranges
 *   - Data validation rules
 *
 * The resulting state string is what the AI reasons over. It's sent once
 * per interaction — no chunking, no RAG, no repeated lookups.
 */

/**
 * Serialize the entire active workbook into a state object.
 * This is the core of the RLM approach.
 *
 * @return {Object} Complete workbook state.
 */
function serializeWorkbookState(activeSheetOverride) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var activeSheet = activeSheetOverride
    ? (ss.getSheetByName(activeSheetOverride) || ss.getActiveSheet())
    : ss.getActiveSheet();
  var sheets = ss.getSheets();

  var state = {
    name: ss.getName(),
    id: ss.getId(),
    activeSheet: activeSheet.getName(),
    namedRanges: _serializeNamedRanges(ss),
    sheets: [],
    serializedAt: new Date().toISOString(),
    tokenEstimate: 0
  };

  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].isSheetHidden()) continue;
    var isActive = (sheets[i].getName() === activeSheet.getName());
    var sheetState = isActive
      ? _serializeSheet(sheets[i])
      : _serializeSheetSummary(sheets[i]);
    state.sheets.push(sheetState);
    state.tokenEstimate += sheetState._tokenEstimate || 0;
  }

  return state;
}

/**
 * Serialize a single sheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object} Sheet state.
 */
function _serializeSheet(sheet) {
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  var formulas = dataRange.getFormulas();
  var fontColors = dataRange.getFontColors();
  var numRows = values.length;
  var numCols = numRows > 0 ? values[0].length : 0;

  // Build cell data — only non-empty cells to keep payload lean
  var cells = [];
  for (var r = 0; r < numRows; r++) {
    for (var c = 0; c < numCols; c++) {
      var val = values[r][c];
      var formula = formulas[r][c];
      if (val === '' && formula === '') continue;

      var cell = {
        row: r + 1,
        col: c + 1,
        ref: _colLetter(c + 1) + (r + 1) // e.g. "A1"
      };

      if (formula) {
        cell.formula = formula;
        cell.value = val; // computed value
      } else {
        cell.value = val;
      }

      // Detect cell role from font color (financial analyst convention)
      var color = fontColors[r][c];
      if (color === '#0000ff' || color === '#0000FF') {
        cell.role = 'input'; // Blue = hard-coded input
      } else if (color === '#008000' || color === '#008000') {
        cell.role = 'crossref'; // Green = cross-tab reference
      } else if (formula) {
        cell.role = 'formula'; // Black formula
      }

      cells.push(cell);
    }
  }

  var sheetState = {
    name: sheet.getName(),
    index: sheet.getIndex(),
    isHidden: sheet.isSheetHidden(),
    dimensions: { rows: sheet.getMaxRows(), cols: sheet.getMaxColumns() },
    dataRange: { rows: numRows, cols: numCols },
    type: _classifySheetType(sheet.getName(), values),
    frozenRows: sheet.getFrozenRows(),
    frozenCols: sheet.getFrozenColumns(),
    cells: cells,
    _tokenEstimate: Math.ceil(JSON.stringify(cells).length / 4)
  };

  return sheetState;
}

/**
 * Serialize a lightweight summary of a non-active sheet.
 * Includes headers (rows 1-2) + first 3 and last 3 data rows ("bookends"),
 * capped at 8 columns (row labels + enough data to see the pattern).
 * Claude can request full detail by having the user switch to that tab.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object} Sheet summary state.
 */
function _serializeSheetSummary(sheet) {
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  var formulas = dataRange.getFormulas();
  var fontColors = dataRange.getFontColors();
  var numRows = values.length;
  var numCols = numRows > 0 ? values[0].length : 0;

  // Cap columns: row labels (A) + enough data cols to see the pattern
  var MAX_SUMMARY_COLS = 8;
  var cappedCols = Math.min(numCols, MAX_SUMMARY_COLS);

  // Determine which rows to include:
  // Header rows (0-1), first 3 data rows, last 3 data rows
  var headerCount = Math.min(2, numRows);
  var dataStartRow = headerCount;
  var totalDataRows = numRows - dataStartRow;

  var rowsToInclude = {};

  // Always include header rows
  for (var h = 0; h < headerCount; h++) {
    rowsToInclude[h] = true;
  }

  // First 3 data rows
  var firstN = Math.min(3, totalDataRows);
  for (var f = 0; f < firstN; f++) {
    rowsToInclude[dataStartRow + f] = true;
  }

  // Last 3 data rows
  var lastStart = Math.max(dataStartRow, numRows - 3);
  for (var l = lastStart; l < numRows; l++) {
    rowsToInclude[l] = true;
  }

  // Build cells for included rows + capped columns only
  var cells = [];
  for (var r = 0; r < numRows; r++) {
    if (!rowsToInclude[r]) continue;
    for (var c = 0; c < cappedCols; c++) {
      var val = values[r][c];
      var formula = formulas[r][c];
      if (val === '' && formula === '') continue;

      var cell = {
        row: r + 1,
        col: c + 1,
        ref: _colLetter(c + 1) + (r + 1)
      };

      if (formula) {
        cell.formula = formula;
        cell.value = val;
      } else {
        cell.value = val;
      }

      var color = fontColors[r][c];
      if (color === '#0000ff' || color === '#0000FF') {
        cell.role = 'input';
      } else if (color === '#008000') {
        cell.role = 'crossref';
      } else if (formula) {
        cell.role = 'formula';
      }

      cells.push(cell);
    }
  }

  return {
    name: sheet.getName(),
    index: sheet.getIndex(),
    isActive: false,
    isSummary: true,
    dimensions: { rows: sheet.getMaxRows(), cols: sheet.getMaxColumns() },
    dataRange: { rows: numRows, cols: numCols },
    totalDataRows: totalDataRows,
    type: _classifySheetType(sheet.getName(), values),
    frozenRows: sheet.getFrozenRows(),
    frozenCols: sheet.getFrozenColumns(),
    cells: cells,
    _tokenEstimate: Math.ceil(JSON.stringify(cells).length / 4)
  };
}

/**
 * Serialize named ranges for the workbook.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Array} Named ranges with their references.
 */
function _serializeNamedRanges(ss) {
  var namedRanges = ss.getNamedRanges();
  return namedRanges.map(function(nr) {
    var range = nr.getRange();
    return {
      name: nr.getName(),
      sheet: range.getSheet().getName(),
      a1: range.getA1Notation()
    };
  });
}

/**
 * Classify a sheet type based on its name and header row.
 *
 * @param {string} name - Sheet tab name.
 * @param {Array[]} values - All cell values.
 * @return {string} Classification.
 */
function _classifySheetType(name, values) {
  var nameLower = name.toLowerCase();
  var headerStr = values.length > 0 ? values[0].join(' ').toLowerCase() : '';

  // Common financial sheet types
  var patterns = [
    { type: 'assumptions',       re: /assumption|input|driver/ },
    { type: 'income_statement',  re: /income|p&l|profit.*loss|revenue/ },
    { type: 'balance_sheet',     re: /balance.*sheet|bs/ },
    { type: 'cash_flow',         re: /cash.*flow|cf/ },
    { type: 'dashboard',         re: /dashboard|kpi|metric|summary/ },
    { type: 'budget',            re: /budget|plan/ },
    { type: 'forecast',          re: /forecast|projection/ },
    { type: 'transactions',      re: /transaction|ledger|journal/ },
    { type: 'cohort',            re: /cohort/ },
    { type: 'scenario',          re: /scenario|sensitivity/ }
  ];

  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].re.test(nameLower) || patterns[i].re.test(headerStr)) {
      return patterns[i].type;
    }
  }

  return 'generic';
}

/**
 * Convert a column number to letter(s). 1 → A, 27 → AA, etc.
 *
 * @param {number} col - 1-indexed column number.
 * @return {string} Column letter(s).
 */
function _colLetter(col) {
  var letter = '';
  while (col > 0) {
    col--;
    letter = String.fromCharCode(65 + (col % 26)) + letter;
    col = Math.floor(col / 26);
  }
  return letter;
}

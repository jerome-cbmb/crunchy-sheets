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
function serializeWorkbookState() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();

  var state = {
    name: ss.getName(),
    id: ss.getId(),
    url: ss.getUrl(),
    locale: ss.getSpreadsheetLocale(),
    timeZone: ss.getSpreadsheetTimeZone(),
    namedRanges: _serializeNamedRanges(ss),
    sheets: [],
    serializedAt: new Date().toISOString(),
    tokenEstimate: 0 // rough token count for the state string
  };

  for (var i = 0; i < sheets.length; i++) {
    var sheetState = _serializeSheet(sheets[i]);
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
  var backgrounds = dataRange.getBackgrounds();
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

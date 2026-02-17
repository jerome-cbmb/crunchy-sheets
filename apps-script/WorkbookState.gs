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
var TOKEN_BUDGET = 120000;

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

  var activeSheetIndex = -1;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].isSheetHidden()) continue;
    var isActive = (sheets[i].getName() === activeSheet.getName());
    if (isActive) activeSheetIndex = state.sheets.length;
    var sheetState = isActive
      ? _serializeSheet(sheets[i])
      : _serializeSheetSummary(sheets[i]);
    state.sheets.push(sheetState);
    state.tokenEstimate += sheetState._tokenEstimate || 0;
  }

  // Token budget: if over budget, degrade active sheet serialization
  if (state.tokenEstimate > TOKEN_BUDGET && activeSheetIndex >= 0) {
    var activeTokens = state.sheets[activeSheetIndex]._tokenEstimate || 0;
    var otherTokens = state.tokenEstimate - activeTokens;

    // First try: truncated (headers + 30 top rows + 10 bottom rows, all columns)
    var truncated = _serializeSheetTruncated(activeSheet);
    if (otherTokens + truncated._tokenEstimate <= TOKEN_BUDGET) {
      state.sheets[activeSheetIndex] = truncated;
      state.tokenEstimate = otherTokens + truncated._tokenEstimate;
      state.truncationNote = 'Active sheet was too large for full serialization. Showing headers + first 30 and last 10 data rows. Switch to a smaller tab for complete cell data.';
    } else {
      // Last resort: summary for the active sheet too
      var summary = _serializeSheetSummary(activeSheet);
      state.sheets[activeSheetIndex] = summary;
      state.tokenEstimate = otherTokens + summary._tokenEstimate;
      state.truncationNote = 'Active sheet was too large even for truncated view. Showing summary only. Switch to a smaller tab for complete cell data.';
    }
  }

  return state;
}

/**
 * Serialize a single sheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object} Sheet state.
 */
function _safeValue(val) {
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'M/d/yyyy');
  if (typeof val === 'number' && !isFinite(val)) return null;
  return val;
}

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
        cell.value = _safeValue(val);
      } else {
        cell.value = _safeValue(val);
      }

      // Detect cell role from font color (financial analyst convention)
      var color = fontColors[r][c];
      if (color === '#0000ff' || color === '#0000FF' || color === '#082fff' || color === '#082FFF') {
        cell.role = 'input'; // Blue = hard-coded input
      } else if (formula) {
        cell.role = 'formula'; // Black formula (includes cross-tab refs)
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
 * Serialize an active sheet in truncated mode — middle ground between full and summary.
 * All columns (no cap), but only headers + first 30 data rows + last 10 data rows.
 * Used when full serialization blows the token budget.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object} Truncated sheet state.
 */
function _serializeSheetTruncated(sheet) {
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  var formulas = dataRange.getFormulas();
  var fontColors = dataRange.getFontColors();
  var numRows = values.length;
  var numCols = numRows > 0 ? values[0].length : 0;

  var headerCount = Math.min(2, numRows);
  var dataStartRow = headerCount;
  var totalDataRows = numRows - dataStartRow;

  var FIRST_N = 30;
  var LAST_N = 10;

  var rowsToInclude = {};

  // Header rows
  for (var h = 0; h < headerCount; h++) {
    rowsToInclude[h] = true;
  }

  // First 30 data rows
  var firstN = Math.min(FIRST_N, totalDataRows);
  for (var f = 0; f < firstN; f++) {
    rowsToInclude[dataStartRow + f] = true;
  }

  // Last 10 data rows
  var lastStart = Math.max(dataStartRow + firstN, numRows - LAST_N);
  for (var l = lastStart; l < numRows; l++) {
    rowsToInclude[l] = true;
  }

  var includedRowCount = Object.keys(rowsToInclude).length;

  // Build cells — all columns, included rows only
  var cells = [];
  for (var r = 0; r < numRows; r++) {
    if (!rowsToInclude[r]) continue;
    for (var c = 0; c < numCols; c++) {
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
        cell.value = _safeValue(val);
      } else {
        cell.value = _safeValue(val);
      }

      var color = fontColors[r][c];
      if (color === '#0000ff' || color === '#0000FF' || color === '#082fff' || color === '#082FFF') {
        cell.role = 'input';
      } else if (formula) {
        cell.role = 'formula';
      }

      cells.push(cell);
    }
  }

  return {
    name: sheet.getName(),
    index: sheet.getIndex(),
    isActive: true,
    isTruncated: true,
    fullDataRows: totalDataRows,
    includedRows: includedRowCount,
    dimensions: { rows: sheet.getMaxRows(), cols: sheet.getMaxColumns() },
    dataRange: { rows: numRows, cols: numCols },
    type: _classifySheetType(sheet.getName(), values),
    frozenRows: sheet.getFrozenRows(),
    frozenCols: sheet.getFrozenColumns(),
    cells: cells,
    _tokenEstimate: Math.ceil(JSON.stringify(cells).length / 4)
  };
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
        cell.value = _safeValue(val);
      } else {
        cell.value = _safeValue(val);
      }

      var color = fontColors[r][c];
      if (color === '#0000ff' || color === '#0000FF' || color === '#082fff' || color === '#082FFF') {
        cell.role = 'input';
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

/**
 * Build a cross-reference graph for all sheets (including hidden).
 * Scans every formula for cross-sheet references + named ranges.
 * Only called when tab_audit skill is active.
 *
 * @return {Object} { refs: { sheetName: [referencedSheets] }, meta: { sheetName: {...} } }
 */
function buildCrossRefGraph() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var refs = {};
  var meta = {};

  var scratchPattern = /^(Sheet\d+|Copy of .+|Untitled|test|temp)/i;
  // Regex handles quoted sheet names with escaped apostrophes, and unquoted names
  var crossRefRegex = /'((?:[^']|'')+)'!|([A-Za-z0-9_]+)!/g;
  var indirectRegex = /INDIRECT\s*\(/i;

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var name = sheet.getName();
    var dataRange = sheet.getDataRange();
    var formulas = dataRange.getFormulas();
    var dataRows = dataRange.getNumRows();
    var dataCols = dataRange.getNumColumns();

    // Check if sheet is truly empty (no non-empty cells)
    var isEmpty = true;
    if (dataRows > 1 || dataCols > 1) {
      isEmpty = false;
    } else {
      // 1x1 range — check if A1 has content
      var vals = dataRange.getValues();
      isEmpty = (vals[0][0] === '' && formulas[0][0] === '');
    }

    // Flatten all formulas into a single string for regex scanning
    var allFormulas = '';
    for (var r = 0; r < formulas.length; r++) {
      for (var c = 0; c < formulas[r].length; c++) {
        if (formulas[r][c]) allFormulas += formulas[r][c] + '\n';
      }
    }

    var hasIndirect = indirectRegex.test(allFormulas);

    // Extract unique cross-sheet references
    var referencedSheets = {};
    var match;
    crossRefRegex.lastIndex = 0;
    while ((match = crossRefRegex.exec(allFormulas)) !== null) {
      var refSheet = match[1] ? match[1].replace(/''/g, "'") : match[2];
      if (refSheet !== name) {
        referencedSheets[refSheet] = true;
      }
    }

    refs[name] = Object.keys(referencedSheets);
    meta[name] = {
      dataRows: isEmpty ? 0 : dataRows,
      isEmpty: isEmpty,
      isScratch: scratchPattern.test(name),
      isHidden: sheet.isSheetHidden(),
      hasIndirect: hasIndirect
    };
  }

  // Add edges from named ranges
  var namedRanges = ss.getNamedRanges();
  for (var n = 0; n < namedRanges.length; n++) {
    var nr = namedRanges[n];
    var nrName = nr.getName();
    var targetSheet = nr.getRange().getSheet().getName();
    // For each sheet, check if its formulas contain this named range
    for (var s = 0; s < sheets.length; s++) {
      var sName = sheets[s].getName();
      if (sName === targetSheet) continue;
      // Quick check: does any formula in this sheet reference the named range?
      var sFormulas = sheets[s].getDataRange().getFormulas();
      var sAll = '';
      for (var sr = 0; sr < sFormulas.length; sr++) {
        for (var sc = 0; sc < sFormulas[sr].length; sc++) {
          if (sFormulas[sr][sc]) sAll += sFormulas[sr][sc] + '\n';
        }
      }
      if (sAll.indexOf(nrName) !== -1) {
        if (refs[sName].indexOf(targetSheet) === -1) {
          refs[sName].push(targetSheet);
        }
      }
    }
  }

  return { refs: refs, meta: meta };
}

// ─── Structural Model (Two-Pass Architecture) ─────────────────────────────

/**
 * Build a lightweight structural model of the workbook (~2-5K tokens).
 * Uses targeted reads — NOT full-sheet getDataRange().
 * Per sheet: name, type, dimensions, headers, sample values, key formulas.
 * Top-level: named ranges, dependency graph from key formulas.
 *
 * @return {Object} Structural model.
 */
function buildStructuralModel() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var activeSheet = ss.getActiveSheet();
  var sheets = ss.getSheets();

  var crossRefRegex = /'((?:[^']|'')+)'!|([A-Za-z0-9_]+)!/g;
  var sheetModels = [];
  var dependencyGraph = {};

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (sheet.isSheetHidden()) continue;

    var name = sheet.getName();
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var isActive = (name === activeSheet.getName());

    var model = {
      name: name,
      index: sheet.getIndex(),
      type: 'generic',
      isActive: isActive,
      dimensions: { rows: sheet.getMaxRows(), cols: sheet.getMaxColumns() },
      dataRange: { rows: lastRow, cols: lastCol },
      frozenRows: sheet.getFrozenRows(),
      frozenCols: sheet.getFrozenColumns(),
      headers: [],
      sampleValues: [],
      keyFormulas: []
    };

    if (lastRow === 0 || lastCol === 0) {
      model.type = 'empty';
      sheetModels.push(model);
      dependencyGraph[name] = [];
      continue;
    }

    // Targeted reads — only what we need
    var headerRows = Math.min(2, lastRow);
    var headerValues = sheet.getRange(1, 1, headerRows, lastCol).getValues();
    model.headers = headerValues;

    // Classify type from headers (reuse existing classifier — it only uses values[0])
    model.type = _classifySheetType(name, headerValues);

    // Sample values (rows 3-5, capped at 8 cols)
    var sampleCols = Math.min(lastCol, 8);
    if (lastRow > 2) {
      var sampleRows = Math.min(3, lastRow - 2);
      model.sampleValues = sheet.getRange(3, 1, sampleRows, sampleCols).getValues();
    }

    // Key formulas (first data row, capped at 8 cols)
    if (lastRow > 2) {
      var formulaCols = Math.min(lastCol, 8);
      var formulaRow = sheet.getRange(3, 1, 1, formulaCols).getFormulas()[0];
      var formulas = [];
      for (var c = 0; c < formulaRow.length; c++) {
        if (formulaRow[c]) {
          formulas.push({ col: _colLetter(c + 1), formula: formulaRow[c] });
        }
      }
      model.keyFormulas = formulas;

      // Build dependency graph from key formulas
      var deps = {};
      for (var f = 0; f < formulas.length; f++) {
        crossRefRegex.lastIndex = 0;
        var match;
        while ((match = crossRefRegex.exec(formulas[f].formula)) !== null) {
          var refSheet = match[1] ? match[1].replace(/''/g, "'") : match[2];
          if (refSheet !== name) deps[refSheet] = true;
        }
      }
      dependencyGraph[name] = Object.keys(deps);
    } else {
      dependencyGraph[name] = [];
    }

    sheetModels.push(model);
  }

  return {
    name: ss.getName(),
    id: ss.getId(),
    activeSheet: activeSheet.getName(),
    namedRanges: _serializeNamedRanges(ss),
    sheets: sheetModels,
    dependencyGraph: dependencyGraph,
    builtAt: new Date().toISOString()
  };
}

/**
 * Get structural model from cache, or build and cache it.
 * DocumentCache TTL: 6 hours (max allowed).
 *
 * @return {Object} Structural model.
 */
function getStructuralModelCached() {
  var cache = CacheService.getDocumentCache();
  var cached = cache.get('structural_model');
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // Corrupted cache — rebuild
    }
  }
  var model = buildStructuralModel();
  var json = JSON.stringify(model);
  // CacheService max value size is 100KB
  if (json.length < 95000) {
    cache.put('structural_model', json, 21600); // 6 hours
  }
  return model;
}

/**
 * Invalidate the cached structural model.
 * Called on structural workbook changes (add/remove/rename sheet).
 */
function invalidateStructuralCache() {
  CacheService.getDocumentCache().remove('structural_model');
}

// ─── Formula X-Ray Payload (BFS Reference Tracer) ─────────────────────────

/**
 * Build a targeted payload for Formula X-Ray.
 * BFS traces all references from target cells (max 3 levels, 100 cells).
 *
 * @param {string} rangeNotation - e.g. "B14", "Sheet1!A1:B2", "$A$1"
 * @return {Object} { targetCells[], tracedCells[], traceStats }
 */
function buildFormulaXrayPayload(rangeNotation) {
  var parsed = _parseRangeNotation(rangeNotation);
  if (parsed.error) return { error: parsed.error };
  if (parsed.cells.length > 10) return { error: 'Too many cells (max 10)' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetCells = [];

  for (var i = 0; i < parsed.cells.length; i++) {
    var tc = parsed.cells[i];
    var sheet = tc.sheet ? ss.getSheetByName(tc.sheet) : ss.getActiveSheet();
    if (!sheet) {
      targetCells.push({ ref: tc.ref, sheet: tc.sheet || '?', error: 'Sheet not found' });
      continue;
    }
    try {
      var range = sheet.getRange(tc.ref);
      var formula = range.getFormula();
      var value = _safeValue(range.getValue());
      var fontColor = range.getFontColor();
      var role = 'value';
      if (fontColor === '#0000ff' || fontColor === '#0000FF' || fontColor === '#082fff' || fontColor === '#082FFF') {
        role = 'input';
      } else if (formula) {
        role = 'formula';
      }
      var headerLabel = _getHeaderLabel(sheet, range.getColumn());
      targetCells.push({
        ref: tc.ref,
        sheet: sheet.getName(),
        formula: formula || null,
        value: value,
        role: role,
        headerLabel: headerLabel
      });
    } catch (e) {
      targetCells.push({ ref: tc.ref, sheet: sheet.getName(), error: e.message });
    }
  }

  // BFS trace references from all target cells
  var traceResult = _traceReferences(targetCells, ss);

  return {
    targetCells: targetCells,
    tracedCells: traceResult.tracedCells,
    traceStats: traceResult.stats
  };
}

/**
 * Parse a range notation string into individual cell references.
 * Handles: Sheet1!A1:B2, 'My Sheet'!$A$1, A1, $A$1, A1:B10
 *
 * @param {string} notation
 * @return {Object} { cells: [{sheet, ref}], error? }
 */
function _parseRangeNotation(notation) {
  if (!notation || !notation.trim()) return { error: 'No range specified' };
  notation = notation.trim();

  var sheet = null;
  var rangeStr = notation;

  // Extract sheet name if present
  var sheetMatch = notation.match(/^'((?:[^']|'')+)'!(.+)$/) || notation.match(/^([A-Za-z0-9_]+)!(.+)$/);
  if (sheetMatch) {
    sheet = sheetMatch[1].replace(/''/g, "'");
    rangeStr = sheetMatch[2];
  }

  // Strip $ signs for parsing
  var cleanRange = rangeStr.replace(/\$/g, '');

  // Check if it's a range (A1:B2) or a single cell (A1)
  var rangeMatch = cleanRange.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (rangeMatch) {
    var startCol = _colNumber(rangeMatch[1].toUpperCase());
    var startRow = parseInt(rangeMatch[2], 10);
    var endCol = _colNumber(rangeMatch[3].toUpperCase());
    var endRow = parseInt(rangeMatch[4], 10);

    var cells = [];
    for (var r = startRow; r <= endRow; r++) {
      for (var c = startCol; c <= endCol; c++) {
        cells.push({ sheet: sheet, ref: _colLetter(c) + r });
      }
    }
    return { cells: cells };
  }

  // Single cell
  var cellMatch = cleanRange.match(/^([A-Z]+)(\d+)$/i);
  if (cellMatch) {
    return { cells: [{ sheet: sheet, ref: cellMatch[1].toUpperCase() + cellMatch[2] }] };
  }

  return { error: 'Could not parse range: ' + notation };
}

/**
 * Convert column letter(s) to number. A → 1, Z → 26, AA → 27.
 */
function _colNumber(letters) {
  var num = 0;
  for (var i = 0; i < letters.length; i++) {
    num = num * 26 + (letters.charCodeAt(i) - 64);
  }
  return num;
}

/**
 * Extract formula references (same-sheet + cross-sheet + INDIRECT detection).
 *
 * @param {string} formula
 * @param {string} currentSheet
 * @return {Array} [{ref, sheet, isIndirect?}]
 */
function _extractFormulaRefs(formula, currentSheet) {
  if (!formula) return [];
  var refs = [];

  // Detect INDIRECT — can't resolve statically
  var indirectRegex = /INDIRECT\s*\(([^)]*)\)/gi;
  var indirectMatch;
  while ((indirectMatch = indirectRegex.exec(formula)) !== null) {
    refs.push({ ref: 'INDIRECT(' + indirectMatch[1] + ')', sheet: currentSheet, isIndirect: true });
  }

  // Cross-sheet references: 'Sheet Name'!A1:B5 or Sheet1!A1
  var crossRefRegex = /'((?:[^']|'')+)'!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?|([A-Za-z0-9_]+)!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/gi;
  var match;
  while ((match = crossRefRegex.exec(formula)) !== null) {
    var refSheet = match[1] ? match[1].replace(/''/g, "'") : match[6];
    var startRef = (match[2] || match[7]).toUpperCase() + (match[3] || match[8]);
    var endRef = (match[4] || match[9]) ? (match[4] || match[9]).toUpperCase() + (match[5] || match[10]) : null;
    if (endRef) {
      refs.push({ ref: startRef + ':' + endRef, sheet: refSheet });
    } else {
      refs.push({ ref: startRef, sheet: refSheet });
    }
  }

  // Same-sheet references: $A$1, A1:B10, A1 (not already captured as cross-sheet)
  // Use a cleaned formula with cross-sheet refs removed to avoid double-counting
  var cleaned = formula.replace(/'((?:[^']|'')+)'!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?/gi, '');
  cleaned = cleaned.replace(/[A-Za-z0-9_]+!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?/gi, '');
  // Also remove INDIRECT contents
  cleaned = cleaned.replace(/INDIRECT\s*\([^)]*\)/gi, '');

  var sameSheetRegex = /\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/gi;
  var sameMatch;
  while ((sameMatch = sameSheetRegex.exec(cleaned)) !== null) {
    // Skip if it looks like a function name (preceded by letters)
    var beforeIdx = sameMatch.index - 1;
    if (beforeIdx >= 0 && /[A-Za-z]/.test(cleaned[beforeIdx])) continue;

    var ref = sameMatch[1].toUpperCase() + sameMatch[2];
    if (sameMatch[3]) {
      ref += ':' + sameMatch[3].toUpperCase() + sameMatch[4];
    }
    refs.push({ ref: ref, sheet: currentSheet });
  }

  return refs;
}

/**
 * BFS trace from target cells, resolving references up to 3 levels deep or 100 cells.
 *
 * @param {Array} targetCells - [{ref, sheet, formula, ...}]
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Object} { tracedCells: [...], stats: {depth, cellsTraced, truncated} }
 */
function _traceReferences(targetCells, ss) {
  var MAX_DEPTH = 3;
  var MAX_CELLS = 100;
  var visited = {};
  var tracedCells = [];
  var queue = [];
  var truncated = false;

  // Seed BFS queue from target cells that have formulas
  for (var i = 0; i < targetCells.length; i++) {
    var tc = targetCells[i];
    if (!tc.formula || tc.error) continue;
    var refs = _extractFormulaRefs(tc.formula, tc.sheet);
    for (var j = 0; j < refs.length; j++) {
      var key = refs[j].sheet + '!' + refs[j].ref;
      if (!visited[key]) {
        visited[key] = true;
        queue.push({ ref: refs[j].ref, sheet: refs[j].sheet, depth: 1, isIndirect: refs[j].isIndirect || false, parentRef: tc.sheet + '!' + tc.ref });
      }
    }
  }

  var maxDepthReached = 0;

  while (queue.length > 0) {
    if (tracedCells.length >= MAX_CELLS) {
      truncated = true;
      break;
    }

    var item = queue.shift();
    if (item.depth > MAX_DEPTH) {
      truncated = true;
      continue;
    }
    if (item.depth > maxDepthReached) maxDepthReached = item.depth;

    // INDIRECT nodes — can't resolve further
    if (item.isIndirect) {
      tracedCells.push({
        ref: item.ref,
        sheet: item.sheet,
        depth: item.depth,
        isIndirect: true,
        parentRef: item.parentRef
      });
      continue;
    }

    // Handle range refs — expand to individual cells (but cap expansion)
    var cellRefs = _expandRangeRef(item.ref);
    if (cellRefs.length > 20) cellRefs = cellRefs.slice(0, 20); // cap per-range expansion

    for (var c = 0; c < cellRefs.length; c++) {
      var cellRef = cellRefs[c];
      var cellKey = item.sheet + '!' + cellRef;
      if (visited[cellKey]) continue;
      visited[cellKey] = true;

      if (tracedCells.length >= MAX_CELLS) { truncated = true; break; }

      var sheet = ss.getSheetByName(item.sheet);
      if (!sheet) {
        tracedCells.push({ ref: cellRef, sheet: item.sheet, depth: item.depth, error: 'Sheet not found', parentRef: item.parentRef });
        continue;
      }

      try {
        var range = sheet.getRange(cellRef);
        var formula = range.getFormula();
        var value = _safeValue(range.getValue());
        var headerLabel = _getHeaderLabel(sheet, range.getColumn());

        tracedCells.push({
          ref: cellRef,
          sheet: item.sheet,
          depth: item.depth,
          formula: formula || null,
          value: value,
          headerLabel: headerLabel,
          isStatic: !formula,
          parentRef: item.parentRef
        });

        // If this cell has a formula, enqueue its references for next level
        if (formula && item.depth < MAX_DEPTH) {
          var childRefs = _extractFormulaRefs(formula, item.sheet);
          for (var cr = 0; cr < childRefs.length; cr++) {
            var childKey = childRefs[cr].sheet + '!' + childRefs[cr].ref;
            if (!visited[childKey]) {
              visited[childKey] = true;
              queue.push({
                ref: childRefs[cr].ref,
                sheet: childRefs[cr].sheet,
                depth: item.depth + 1,
                isIndirect: childRefs[cr].isIndirect || false,
                parentRef: item.sheet + '!' + cellRef
              });
            }
          }
        }
      } catch (e) {
        tracedCells.push({ ref: cellRef, sheet: item.sheet, depth: item.depth, error: e.message, parentRef: item.parentRef });
      }
    }
  }

  return {
    tracedCells: tracedCells,
    stats: {
      depth: maxDepthReached,
      cellsTraced: tracedCells.length,
      truncated: truncated
    }
  };
}

/**
 * Expand a range ref (A1:B3) into individual cell refs, or return single cell as-is.
 */
function _expandRangeRef(ref) {
  var rangeMatch = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!rangeMatch) return [ref];

  var startCol = _colNumber(rangeMatch[1].toUpperCase());
  var startRow = parseInt(rangeMatch[2], 10);
  var endCol = _colNumber(rangeMatch[3].toUpperCase());
  var endRow = parseInt(rangeMatch[4], 10);

  var cells = [];
  for (var r = startRow; r <= endRow; r++) {
    for (var c = startCol; c <= endCol; c++) {
      cells.push(_colLetter(c) + r);
    }
  }
  return cells;
}

/**
 * Get the header label (row 1) for a given column.
 */
function _getHeaderLabel(sheet, col) {
  try {
    var val = sheet.getRange(1, col).getValue();
    return val ? String(val) : '';
  } catch (e) {
    return '';
  }
}

/**
 * Fetch specific range data for Pass 2 of two-pass architecture.
 * Takes array of {sheet, range} and returns cell data in the same
 * format as _serializeSheet().
 *
 * @param {Array} requests - [{sheet: string, range: string}]
 * @return {Object} Map of "Sheet!Range" → {cells: [...]}
 */
function fetchRangeData(requests) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {};

  for (var i = 0; i < requests.length; i++) {
    var req = requests[i];
    var sheet = ss.getSheetByName(req.sheet);
    if (!sheet) {
      result[req.sheet + '!' + req.range] = { error: 'Sheet not found: ' + req.sheet };
      continue;
    }

    try {
      var range = sheet.getRange(req.range);
      var values = range.getValues();
      var formulas = range.getFormulas();
      var fontColors = range.getFontColors();
      var startRow = range.getRow();
      var startCol = range.getColumn();
      var cells = [];

      for (var r = 0; r < values.length; r++) {
        for (var c = 0; c < values[r].length; c++) {
          var val = values[r][c];
          var formula = formulas[r][c];
          if (val === '' && formula === '') continue;

          var cell = {
            row: startRow + r,
            col: startCol + c,
            ref: _colLetter(startCol + c) + (startRow + r)
          };

          if (formula) {
            cell.formula = formula;
            cell.value = _safeValue(val);
          } else {
            cell.value = _safeValue(val);
          }

          var color = fontColors[r][c];
          if (color === '#0000ff' || color === '#0000FF' || color === '#082fff' || color === '#082FFF') {
            cell.role = 'input';
          } else if (formula) {
            cell.role = 'formula';
          }

          cells.push(cell);
        }
      }

      result[req.sheet + '!' + req.range] = { cells: cells };
    } catch (e) {
      result[req.sheet + '!' + req.range] = { error: e.message };
    }
  }

  return result;
}

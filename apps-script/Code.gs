/**
 * Crunchy Sheets — AI CFO for Google Sheets
 * Main entry point for the Apps Script add-on.
 *
 * Architecture: Apps Script sidebar → Cloud Functions backend → Claude API
 * The RLM approach: serialize the entire workbook as a state string and send
 * it once per interaction, so the model reasons over structure, not fragments.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const CLOUD_FUNCTION_BASE = 'https://us-central1-crunchy-sheets.cloudfunctions.net';

// ─── Menu & Sidebar ──────────────────────────────────────────────────────────

/**
 * Runs when the spreadsheet opens. Adds the Crunchy Sheets menu.
 */
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('Open', 'showSidebar')
    .addSeparator()
    .addItem('Health Check', 'runHealthCheck')
    .addItem('About', 'showAbout')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

/**
 * Homepage trigger for add-on card (Workspace add-on mode).
 */
function onHomepage() {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Crunchy Sheets'))
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('Open the sidebar from the menu: Crunchy Sheets > Open')
      )
    )
    .build();
}

/**
 * Opens the Crunchy Sheets sidebar.
 */
function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Crunchy Sheets')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Opens the expanded chat view as a modeless dialog (700x750).
 * Chat state is transferred via UserProperties (saveChatHistory / loadChatHistory).
 */
function openExpandedView() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .append('<script>var isDialogMode = true;</script>')
    .setWidth(700)
    .setHeight(750);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Crunchy Sheets');
}

/**
 * Shows an about dialog.
 */
function showAbout() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    'Crunchy Sheets v0.1.0',
    'AI CFO for Google Sheets.\nBy Crunchy Numbers (crunchy.tools)',
    ui.ButtonSet.OK
  );
}

// ─── Web App ────────────────────────────────────────────────────────────────

/**
 * Web app entry point. Serves Sidebar.html as a standalone page
 * so the ↗ button can open a real browser window via window.open().
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Crunchy Sheets')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Returns the deployed web app URL for pre-fetching in the sidebar.
 * @return {string} The web app URL.
 */
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * Returns the name of the currently active sheet.
 * Called before opening the web app window so the correct sheet context is preserved.
 * @return {string} Active sheet name.
 */
function getActiveSheetName() {
  return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getName();
}

/**
 * Save the active sheet override to UserProperties (for web app mode).
 * @param {string} name - Sheet name to persist, or empty string to clear.
 */
function saveActiveSheetOverride(name) {
  PropertiesService.getUserProperties().setProperty('activeSheetOverride', name || '');
}

/**
 * Load the active sheet override from UserProperties.
 * @return {string|null} Sheet name, or null if not set.
 */
function loadActiveSheetOverride() {
  return PropertiesService.getUserProperties().getProperty('activeSheetOverride') || null;
}

// ─── Backend Communication ───────────────────────────────────────────────────

/**
 * Sends the current workbook state + user prompt to the /analyze Cloud Function.
 * Called from the sidebar via google.script.run.
 *
 * @param {string} userPrompt - The user's question or instruction.
 * @return {Object} The AI response with actions and commentary.
 */
function analyzeWorkbook(userPrompt) {
  var state = serializeWorkbookState();
  var token = ScriptApp.getOAuthToken();

  var userRole = getUserRole();

  var payload = {
    workbookState: state,
    prompt: userPrompt,
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
    userEmail: Session.getActiveUser().getEmail(),
    userRole: userRole || undefined
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(CLOUD_FUNCTION_BASE + '/analyze', options);
  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();

  var result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    // Cloud Function returned non-JSON (GCP infrastructure error, timeout, etc.)
    Logger.log('Non-JSON response (' + responseCode + '): ' + responseText.substring(0, 500));
    return { error: responseCode + ': ' + responseText.substring(0, 200) };
  }

  if (result.error) {
    return result;
  }

  if (result.actions && result.actions.length > 0) {
    Logger.log('Actions received: ' + result.actions.length + ' — awaiting user confirmation in sidebar');
  }

  return result;
}

/**
 * Returns the workbook state + auth token for direct streaming from sidebar.
 * The sidebar calls this, then uses fetch() to stream from Vercel.
 *
 * @param {string} userPrompt - The user's question or instruction.
 * @return {Object} Payload for the Vercel /analyze endpoint.
 */
function getAnalyzePayload(userPrompt, activeSheetOverride, skillHint) {
  var state = serializeWorkbookState(activeSheetOverride || null);
  var token = ScriptApp.getOAuthToken();
  var userRole = getUserRole();

  var crossRefGraph = null;
  if (skillHint === 'tab_audit') {
    crossRefGraph = buildCrossRefGraph();
  }

  return {
    workbookState: state,
    prompt: userPrompt,
    token: token,
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
    userEmail: Session.getActiveUser().getEmail(),
    userRole: userRole || undefined,
    crossRefGraph: crossRefGraph,
    isStructuralPass: false
  };
}

// ─── Action Execution ────────────────────────────────────────────────────────

/**
 * Apply a set of CellActions to the active spreadsheet.
 * Called from the sidebar after user confirms via the "Apply All" button.
 * Delegates to executeActions() in ActionExecutor.gs.
 *
 * @param {Array} actions - Array of CellAction objects.
 * @return {Object} Result: { applied: number, skipped: number, errors: string[] }
 */
function applyActions(actions) {
  Logger.log('[Code] applyActions called with ' + (actions ? actions.length : 0) + ' actions');
  return executeActions(actions);
}

// ─── Health Check ────────────────────────────────────────────────────────────

/**
 * Quick health check — calls the backend with a special skill.
 */
function runHealthCheck() {
  var state = serializeWorkbookState();
  var token = ScriptApp.getOAuthToken();

  var payload = {
    workbookState: state,
    prompt: 'Run a full workbook health check.',
    skill: 'workbook_health_check',
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
    userEmail: Session.getActiveUser().getEmail()
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(CLOUD_FUNCTION_BASE + '/analyze', options);
  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();

  var result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Health Check Error', responseCode + ': ' + responseText.substring(0, 200), SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  SpreadsheetApp.getUi().alert('Health Check', result.summary || result.error || 'Complete.', SpreadsheetApp.getUi().ButtonSet.OK);
}

// ─── Structural Cache Warm ───────────────────────────────────────────────────

/**
 * Warm the structural model cache and return sheet metadata.
 * Called once on sidebar open to eliminate first-message cold start
 * and provide Command Palette metadata (sheet names).
 *
 * @return {Object} { sheetNames: string[], sheetCount: number, activeSheet: string }
 */
function warmStructuralCache() {
  var cache = CacheService.getDocumentCache();
  var wasCached = !!cache.get('structural_model');
  var t0 = Date.now();
  var model = getStructuralModelCached(); // builds + caches if not already cached
  var buildTimeMs = Date.now() - t0;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  return {
    sheetNames: sheets.map(function(s) { return s.getName(); }),
    sheetCount: sheets.length,
    activeSheet: ss.getActiveSheet().getName(),
    cached: wasCached,
    buildTimeMs: buildTimeMs
  };
}

/**
 * Force rescan: invalidate cache then warm it fresh.
 * Called from /rescan slash command.
 *
 * @return {Object} Same shape as warmStructuralCache().
 */
function rescanStructuralCache() {
  invalidateStructuralCache();
  return warmStructuralCache();
}

/**
 * Return sheet names for Command Palette metadata.
 * Lightweight call (~5ms, no serialization).
 *
 * @return {string[]} Array of sheet names.
 */
function getSheetNames() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().map(function(s) {
    return s.getName();
  });
}

// ─── Chat History Persistence ───────────────────────────────────────────────

/**
 * Save chat history to UserProperties for state transfer between sidebar/dialog.
 * @param {string} stateJson - JSON string of chat messages.
 */
function saveChatHistory(stateJson) {
  PropertiesService.getUserProperties().setProperty('chatHistory', stateJson);
}

/**
 * Load chat history from UserProperties.
 * @return {string|null} JSON string of chat messages, or null.
 */
function loadChatHistory() {
  return PropertiesService.getUserProperties().getProperty('chatHistory');
}

// ─── User Role ──────────────────────────────────────────────────────────────

/**
 * Save the user's selected role (builder, reviewer, inherited, exploring).
 * @param {string} role - The selected role.
 */
function saveUserRole(role) {
  PropertiesService.getUserProperties().setProperty('userRole', role);
}

/**
 * Get the user's previously selected role.
 * @return {string|null} The role, or null if not set.
 */
function getUserRole() {
  return PropertiesService.getUserProperties().getProperty('userRole');
}

// ─── Cell Navigation ─────────────────────────────────────────────────────────

/**
 * Navigate to a specific cell in the spreadsheet.
 * Used by clickable cell references in chat and "View Proof" links.
 *
 * @param {string} sheetName - Target sheet name (empty string = active sheet).
 * @param {string} cellRef - A1-notation cell reference (e.g., "B14" or "A1:C5").
 */
function navigateToCell(sheetName, cellRef) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getActiveSheet();
  if (!sheet) sheet = ss.getActiveSheet();
  SpreadsheetApp.setActiveSheet(sheet);
  if (cellRef) sheet.setActiveSelection(cellRef);
}

// ─── Range Selector ─────────────────────────────────────────────────────────

/**
 * Returns the currently selected range as "SheetName!A1Notation".
 * Called from sidebar range selector component.
 * @return {string} e.g. "Dashboard!B2:F20", or empty string if nothing selected.
 */
function getSelectedRange() {
  var range = SpreadsheetApp.getActiveRange();
  if (!range) return '';
  return range.getSheet().getName() + '!' + range.getA1Notation();
}

// ─── Two-Pass Architecture ──────────────────────────────────────────────────

/**
 * Returns either a structural payload (lightweight, ~2-5K tokens) or a full
 * payload (existing path) depending on the skill's needs.
 *
 * @param {string} userPrompt - The user's question or instruction.
 * @param {string} skillHint - Optional skill ID hint.
 * @return {Object} Payload for Vercel with isStructuralPass flag.
 */
function getStructuralPayload(userPrompt, skillHint) {
  // Skills that need full workbook context
  var fullContextSkills = { workbook_format: true, prove_it: true, tab_audit: true };
  if (skillHint && fullContextSkills[skillHint]) {
    return getAnalyzePayload(userPrompt, null, skillHint);
  }

  var model = getStructuralModelCached();

  // Inline staleness check — verify active sheet is current
  var currentActive = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getName();
  if (model.activeSheet !== currentActive) {
    invalidateStructuralCache();
    model = getStructuralModelCached();
  }

  return {
    structuralModel: model,
    prompt: userPrompt,
    token: ScriptApp.getOAuthToken(),
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
    userEmail: Session.getActiveUser().getEmail(),
    userRole: getUserRole() || undefined,
    isStructuralPass: true
  };
}

/**
 * Returns structural model + BFS-traced xray payload for Formula X-Ray.
 * Used when /xray specifies a cell — the BFS tracer provides the full
 * reference chain so Claude doesn't need full workbook serialization.
 *
 * @param {string} rangeNotation - e.g. "B14", "Sheet1!A1:B2"
 * @return {Object} Payload with isXrayPass: true
 */
function getFormulaXrayPayload(rangeNotation) {
  var model = getStructuralModelCached();

  // Inline staleness check
  var currentActive = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getName();
  if (model.activeSheet !== currentActive) {
    invalidateStructuralCache();
    model = getStructuralModelCached();
  }

  var xrayPayload = buildFormulaXrayPayload(rangeNotation);

  return {
    structuralModel: model,
    xrayPayload: xrayPayload,
    isXrayPass: true,
    prompt: '',
    token: ScriptApp.getOAuthToken(),
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
    userEmail: Session.getActiveUser().getEmail(),
    userRole: getUserRole() || undefined
  };
}

/**
 * onChange trigger — invalidates structural cache on structural changes.
 * Cell edits (EDIT) don't change structure, so they're ignored.
 *
 * @param {Object} e - Change event.
 */
function onWorkbookChange(e) {
  var structuralChanges = { INSERT_GRID: true, REMOVE_GRID: true, RENAME: true, OTHER: true };
  if (e && e.changeType && structuralChanges[e.changeType]) {
    invalidateStructuralCache();
  }
}

// Update onInstall to register onChange trigger
var _originalOnInstall = onInstall;
onInstall = function(e) {
  _originalOnInstall(e);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var triggers = ScriptApp.getUserTriggers(ss);
    var hasOnChange = false;
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'onWorkbookChange') {
        hasOnChange = true;
        break;
      }
    }
    if (!hasOnChange) {
      ScriptApp.newTrigger('onWorkbookChange')
        .forSpreadsheet(ss)
        .onChange()
        .create();
    }
  } catch (err) {
    // Trigger quota exceeded — structural model will be built fresh each time
    Logger.log('Could not install onChange trigger: ' + err.message);
  }
};

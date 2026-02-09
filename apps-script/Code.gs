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
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Crunchy Sheets')
    .addItem('Open', 'showSidebar')
    .addSeparator()
    .addItem('Health Check', 'runHealthCheck')
    .addItem('About', 'showAbout')
    .addToUi();
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

  var payload = {
    workbookState: state,
    prompt: userPrompt,
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
    userEmail: Session.getActiveUser().getEmail()
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
  var result = JSON.parse(response.getContentText());

  if (result.actions && result.actions.length > 0) {
    // Actions are returned to the sidebar for user confirmation before applying.
    // The sidebar will call applyActions() after the user clicks "Apply All".
    Logger.log('Actions received: ' + result.actions.length + ' — awaiting user confirmation in sidebar');
  }

  return result;
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
  var result = JSON.parse(response.getContentText());

  SpreadsheetApp.getUi().alert('Health Check', result.summary || 'Complete.', SpreadsheetApp.getUi().ButtonSet.OK);
}

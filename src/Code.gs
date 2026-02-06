/**
 * Crunchy Sheets - Financial Modeling AI Assistant
 * Core Google Apps Script for workbook state serialization and AI routing
 */

// Global configuration
const CONFIG = {
  API_ENDPOINT: 'https://claude.anthropic.com/v1/sheets-finance',
  SKILLS: [
    'personal_budget',
    'cash_flow_forecast',
    'bank_transaction_analysis',
    'workbook_health_check',
    'financial_model_templates',
    'tax_prep_organizer',
    'subscription_tracker',
    'investor_update_generator',
    'scenario_modeler',
    'financial_statement_exporter'
  ],
  DEFAULT_MODEL: 'anthropic/claude-3-5-sonnet',
  ADVANCED_MODEL: 'anthropic/claude-opus-4-6'
};

/**
 * Serialize current workbook state
 * @return {Object} Structured representation of workbook
 */
function serializeWorkbookState() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  
  const workbookState = {
    name: ss.getName(),
    sheets: sheets.map(sheet => ({
      name: sheet.getName(),
      type: _identifySheetType(sheet),
      dimensions: {
        rows: sheet.getMaxRows(),
        columns: sheet.getMaxColumns()
      },
      nonEmptyCells: _countNonEmptyCells(sheet)
    }))
  };
  
  return workbookState;
}

/**
 * Identify sheet type based on content and structure
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 
 * @return {string} Sheet type classification
 */
function _identifySheetType(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  
  // Basic heuristics for sheet type detection
  if (values[0].some(cell => /income|revenue|earnings/i.test(cell))) {
    return 'income_statement';
  }
  
  if (values[0].some(cell => /expense|cost|spending/i.test(cell))) {
    return 'expense_tracker';
  }
  
  return 'generic';
}

/**
 * Count non-empty cells in a sheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 
 * @return {number} Number of non-empty cells
 */
function _countNonEmptyCells(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  
  return values.flat().filter(cell => cell !== '').length;
}

/**
 * Select appropriate AI model based on workbook complexity
 * @param {Object} workbookState 
 * @return {string} Selected model
 */
function selectAIModel(workbookState) {
  const complexity = workbookState.sheets.reduce((score, sheet) => {
    return score + sheet.nonEmptyCells;
  }, 0);
  
  return complexity > 5000 
    ? CONFIG.ADVANCED_MODEL 
    : CONFIG.DEFAULT_MODEL;
}

/**
 * Invoke AI analysis
 * @param {Object} workbookState 
 * @param {string} skill 
 */
function invokeAIAnalysis(workbookState, skill) {
  const model = selectAIModel(workbookState);
  
  // Placeholder for actual API call
  Logger.log(`Invoking skill: ${skill} with model: ${model}`);
}

/**
 * Create sidebar
 */
function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Crunchy Sheets AI')
    .setWidth(300);
  
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Onopen trigger to add custom menu
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Crunchy Sheets')
    .addItem('Open AI Assistant', 'showSidebar')
    .addToUi();
}
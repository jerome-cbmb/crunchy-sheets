# CLAUDE.md — Crunchy Sheets

AI CFO for Google Sheets. Understands workbook structure, thinks like a financial analyst, returns structured cell mutations.

## Architecture

```
Sidebar (HTML/JS)  →  Apps Script (.gs)  →  Cloud Function /analyze  →  Claude API
                                                                          ↓
                                                    structured JSON { actions[], response }
                                                                          ↓
Sidebar preview  ←  Apps Script applyActions()  ←  action-parser validates  ←
```

**RLM (Runtime Language Model):** The entire workbook is serialized into a single JSON state string on every request. No RAG, no chunking, no repeated lookups. Claude reasons over full workbook structure in context.

## Data Flow (happy path)

1. User types in sidebar → `send()` calls `google.script.run.analyzeWorkbook(prompt)`
2. `Code.gs:analyzeWorkbook()` calls `serializeWorkbookState()` (WorkbookState.gs)
3. Serialized state + prompt + Bearer token sent via `UrlFetchApp.fetch()` to Cloud Function `/analyze`
4. `analyze.ts:handleAnalyze()` verifies Google OAuth token, routes to skill, calls Claude
5. Claude returns JSON with `actions[]`, `response`, `summary`
6. `action-parser.ts:parseClaudeResponse()` extracts and validates the JSON block
7. Result returned to sidebar → shows AI response + actions preview panel
8. User clicks "Apply All" → `google.script.run.applyActions(actions)`
9. `ActionExecutor.gs:executeActions()` applies each action to the spreadsheet

## Project Structure

```
crunchy-sheets/
├── apps-script/              # Google Apps Script add-on (deployed via clasp)
│   ├── Code.gs               # Menu, sidebar launcher, analyzeWorkbook(), applyActions()
│   ├── Sidebar.html          # Chat UI, skill chips, action preview/apply, results panel
│   ├── WorkbookState.gs      # Workbook → JSON serializer (RLM core)
│   ├── ActionExecutor.gs     # Applies CellAction[] to the spreadsheet
│   ├── OAuth.gs              # getAuthToken(), checkAuthStatus(), registerUser()
│   ├── Skills.gs             # 10 financial skills registry (sidebar dropdown source)
│   ├── appsscript.json       # Manifest (V8 runtime, America/New_York)
│   └── .clasp.json           # Bound to test spreadsheet (parentId: 1hzhET6...)
│
├── cloud-functions/          # GCP Cloud Functions backend (TypeScript)
│   ├── src/
│   │   ├── index.ts          # HTTP entry points: /analyze and /auth (CORS, routing)
│   │   ├── analyze.ts        # Core handler: auth → skill route → Claude call → parse → track usage
│   │   ├── skill-router.ts   # 10 skill definitions with keywords, instructions, model tiers
│   │   ├── action-parser.ts  # Extracts JSON from Claude response, validates each action
│   │   └── auth.ts           # Google OAuth token verification, Supabase user upsert
│   ├── package.json
│   └── tsconfig.json         # Strict, ES2022, commonjs output to dist/
│
├── supabase/
│   └── migrations/
│       └── 001_create_tables.sql  # users, sessions, usage tables + usage_monthly view
│
└── README.md
```

## 6 Action Types

Claude returns these in the `actions[]` array. ActionExecutor.gs applies them to the spreadsheet.

| Type | Required Fields | What It Does |
|------|----------------|--------------|
| `set_value` | sheet, cell, value | Write a literal value (string/number/boolean) |
| `set_formula` | sheet, cell, formula | Write a formula (must start with `=`) |
| `format_cell` | sheet, cell, format | Apply formatting (fontColor, background, bold, numberFormat) |
| `add_sheet` | sheetName | Create a new tab (skips if exists) |
| `rename_sheet` | sheet, sheetName | Rename existing tab (skips if target name taken) |
| `add_named_range` | rangeName, rangeA1 | Create/overwrite a named range (supports `Sheet!A1` notation) |

Each action is independently try/caught — one failure doesn't stop the batch.

## 10 Financial Skills

Routing: explicit selection from sidebar chip → `[skill:xxx]` prefix in prompt → keyword regex auto-detect → default (general analysis, Sonnet).

| Skill | Model | Category |
|-------|-------|----------|
| Variance Analysis | Sonnet | analysis |
| Cash Flow Forecasting | Opus | modeling |
| Revenue Waterfall | Sonnet | analysis |
| Expense Categorization | Sonnet | automation |
| Unit Economics | Opus | analysis |
| Cohort Analysis | Opus | analysis |
| Scenario Modeling | Opus | modeling |
| KPI Dashboard | Sonnet | reporting |
| Investor Metrics | Sonnet | reporting |
| Budget vs Actual | Sonnet | analysis |

Sonnet skills are fast/cheap. Opus skills require deeper reasoning.

## Financial Formatting Conventions (non-negotiable)

| Role | Font Color | Hex | Example |
|------|-----------|-----|---------|
| Hard-coded inputs | Blue | `#0000FF` | Revenue growth rate: 15% |
| Formulas | Black | `#000000` | `=B2*(1+B3)` |
| Cross-tab references | Green | `#008000` | `=Assumptions!B5` |

WorkbookState.gs detects these colors and tags cells with `role: 'input'`, `'formula'`, or `'crossref'`.

## Commands

### Apps Script

```bash
cd apps-script
clasp push          # Deploy to bound spreadsheet
clasp open          # Open in Apps Script editor
clasp login         # Authenticate (first time)
```

### Cloud Functions

```bash
cd cloud-functions
npm install         # Install dependencies
npm run build       # tsc → dist/
npm run watch       # tsc --watch
npm run serve       # Build + local server on :8080 (functions-framework)
npm run deploy      # Build + deploy both /analyze and /auth to GCP
```

Deploy scripts read secrets from `~/.config/secrets/` at deploy time:
- `npm run deploy:analyze` — deploys the /analyze function
- `npm run deploy:auth` — deploys the /auth function
- `npm run deploy` — builds + deploys both

### Supabase

```bash
# Run migration via Supabase Dashboard SQL Editor or:
supabase db push --db-url "postgresql://postgres:[PASSWORD]@db.diselpdcsgjgetgmixhc.supabase.co:5432/postgres"
```

## Environment Variables (Cloud Functions)

| Variable | Value / Source |
|----------|---------------|
| `ANTHROPIC_API_KEY` | `~/.config/secrets/anthropic-crunchy-sheets-key` |
| `SUPABASE_URL` | `https://diselpdcsgjgetgmixhc.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `~/.config/secrets/supabase-crunchy-sheets-service-key` |

Set automatically during `npm run deploy` via `--set-env-vars` flags.

## GCP & Supabase Details

| Setting | Value |
|---------|-------|
| GCP Project ID | `crunchy-sheets` |
| GCP Project Number | `930082478249` |
| GCP Region | `us-central1` |
| Cloud Functions Runtime | Node.js 20 |
| Supabase Ref | `diselpdcsgjgetgmixhc` |
| Supabase Region | `us-west-2` |
| Cloud Function Base URL | `https://us-central1-crunchy-sheets.cloudfunctions.net` |

## Apps Script Binding

The `.clasp.json` binds to a test spreadsheet:
- **Script ID:** `1A8nuOII0mMO7Zs8746k2CscfS2Zgf524yv2qipYT3KxTojKHln0_TNQ5`
- **Parent Spreadsheet ID:** `1hzhET6HUcOA0OlzvP4lR6s2LPCLNSBS3lfsoVcPBzhk`

## Supabase Schema

Three tables + one view:
- **users** — google_id (unique), email, plan (free/pro/team/enterprise)
- **sessions** — user_id (FK), spreadsheet_id, workbook_state_hash, model_used
- **usage** — user_id (FK), session_id (FK), tokens_in/out, skill_used, cost_usd
- **usage_monthly** (view) — aggregated per-user per-month for billing

RLS enabled on all tables, service role bypasses.

## Auth Flow

1. Apps Script calls `ScriptApp.getOAuthToken()` (Google access token)
2. Sent as `Bearer` header with every request to Cloud Functions
3. Cloud Function calls Google's `/oauth2/v3/userinfo` to verify
4. User upserted into Supabase `users` table on first request

## Key Design Decisions

- **No RAG:** Full workbook in context every time. Simpler, more accurate, higher token cost.
- **Actions require confirmation:** Claude returns proposed actions → sidebar shows preview → user clicks "Apply All" before anything touches the spreadsheet.
- **Skill routing is layered:** Explicit sidebar selection takes priority, then `[skill:xxx]` prefix, then keyword auto-detect, then default.
- **Model selection per skill:** Opus for complex reasoning (cash flow, unit economics, cohorts, scenarios). Sonnet for fast analysis (variance, BvA, dashboard, categorization).
- **Sheet type classification:** WorkbookState.gs auto-classifies tabs (assumptions, income_statement, balance_sheet, etc.) from name + header row patterns.

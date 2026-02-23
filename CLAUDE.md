# CLAUDE.md — Crunchy Sheets

AI CFO for Google Sheets. Understands workbook structure, thinks like a financial analyst, returns structured cell mutations.

## Architecture

```
Sidebar (HTML/JS) → getStructuralPayload() → Vercel /api/analyze → Claude API (streaming)
                                                                          ↓
                                                          streamed JSON { actions[], response }
                                                          — OR —
                                                          { type: "data_request", ranges[] }
                                                                          ↓
                    ← ReadableStream ← ─────────────────────────────────── ←
                          ↓
                    If data_request: fetchRangeData() → Pass 2 → stream again
                    If direct answer: render + actions panel

User clicks "Apply All" → google.script.run.applyActions(actions)
                             → ActionExecutor.gs writes to spreadsheet
```

**Two-pass "Understand Then Look" architecture.** Most requests use a lightweight structural model (~2-5K tokens) instead of full workbook serialization. Claude sees headers, sample values, and key formulas — enough to answer structural questions directly or request specific ranges for deeper analysis.

**Pass 1 (structural):** `getStructuralPayload()` returns cached metadata built from targeted reads (2 header rows, 3 sample rows, 1 formula row per sheet — no full-sheet `getDataRange()`). If Claude needs more data, it returns a `data_request` JSON with specific ranges.

**Pass 2 (targeted):** Sidebar calls `fetchRangeData()` to read only the requested cells, then streams a second request with that data appended.

**X-Ray hybrid path:** Formula X-Ray (`/xray B14`) uses a third path — `getFormulaXrayPayload()` returns structural model + BFS-traced reference chain (3 levels deep, 100 cells max). Single-pass streaming, no full serialization needed.

**Full-context fallback:** Three skills (`workbook_format`, `prove_it`, `tab_audit`) always use full serialization via `getAnalyzePayload()`. The routing happens server-side in `getStructuralPayload()` based on a `fullContextSkills` map.

**Image input:** Sidebar sends images (drag-and-drop or `+` button, 4MB max) as base64 data URIs directly to Vercel via `imageBase64` field. Bypasses Apps Script entirely. Vercel AI SDK wraps into multimodal content array.

**Full serialization (RLM):** Still available for full-context skills. Active sheet gets full cell data, other sheets get headers + bookend rows (first 3 + last 3, capped at 8 columns). Adaptive budget: 120K token target with graceful degradation. Vercel keeps a 150K hard guard.

## Data Flow (happy path)

1. First open: onboarding card asks user role (builder/reviewer/inherited/exploring) → saved to `UserProperties`
2. User types in sidebar → `send()` routes based on command:
   - `/xray <cell>` → `getFormulaXrayPayload(cell)` → `streamXrayAnalysis()` (BFS-traced single-pass)
   - `/xray` (bare) → structural path (Claude picks most complex formula)
   - `/rescan` → `rescanStructuralCache()` (immediate, no AI call)
   - `/explain` → `explain_tab` skill via structural path
   - Other → `getStructuralPayload(prompt, skillHint)`
3. `getStructuralPayload()` checks if the skill needs full context. If yes → falls back to `getAnalyzePayload()`. If no → returns cached structural model. Includes inline staleness check (verifies active sheet matches cache).
4. Sidebar routes by payload type:
   - **X-Ray path** (`isXrayPass`) → `streamXrayAnalysis()`: single-pass with structural model + BFS payload
   - **Structural path** (`isStructuralPass`) → `streamStructuralAnalysis()`: two-pass with optional `data_request`
   - **Full-context path** → `streamAnalysis()`: full workbook state
5. Thinking steps show progress at each phase (reading → analyzing → fetching → verifying)
6. `route.ts` verifies Google OAuth token, routes to skill, builds user message (3 builders: `buildXrayUserMessage`, `buildStructuralUserMessage`, `buildUserMessage`), supports multimodal images via content array
7. Claude streams JSON with `actions[]`, `response`, `summary` (or `type: "formula_xray"` with optional `cells[]` for multi-cell, or `type: "data_request"` for range requests)
8. On stream complete: action-parser extracts and validates JSON block. Formula X-Ray responses (single or multi-cell) short-circuit with passthrough
9. Assistant response rendered as markdown + actions preview panel. Formula X-Ray renders color-coded breakdown card(s) with verification badges
10. User clicks "Apply All" → `google.script.run.applyActions(actions)` (X-Ray is read-only, no actions)
11. `ActionExecutor.gs:executeActions()` applies each action to the spreadsheet

## Project Structure

```
crunchy-sheets/
├── app/                          # Next.js API routes (Vercel serverless)
│   └── api/
│       ├── analyze/route.ts      # Streaming Claude call: auth → skill route → stream → parse
│       └── auth/route.ts         # Google OAuth token verification endpoint
│
├── lib/                          # Shared TypeScript modules
│   ├── types.ts                  # CellAction, SkillDefinition, AnalyzeRequest/Response, DataRequest, ConversationEntry
│   ├── skill-router.ts           # 14 skill definitions with keywords, instructions, model tiers, useFullContext flag
│   ├── action-parser.ts          # Extracts JSON from Claude response, validates actions; formula_xray passthrough
│   ├── system-prompt.ts          # Builds system prompt with temporal awareness + user role context
│   ├── auth.ts                   # Google OAuth token verification, Supabase user upsert
│   └── usage.ts                  # Token usage tracking to Supabase
│
├── apps-script/                  # Google Apps Script add-on (deployed via clasp)
│   ├── Code.gs                   # Menu, sidebar launcher, getAnalyzePayload(), getStructuralPayload(), applyActions(), openExpandedView(), onWorkbookChange() trigger, user role persistence
│   ├── Sidebar.html              # Chat UI, two-pass streaming (streamAnalysis + streamStructuralAnalysis), markdown rendering, skill chips, action preview/apply, formula x-ray card, phased loading states, compact chat history, onboarding, window toggle, /xray /format /prove /audit slash commands
│   ├── WorkbookState.gs          # Workbook → JSON serializer (RLM core) with adaptive token budget, buildStructuralModel() + cache, fetchRangeData(), buildCrossRefGraph() + getCrossRefGraphCached()
│   ├── ActionExecutor.gs         # Applies CellAction[] to the spreadsheet
│   ├── OAuth.gs                  # getAuthToken(), checkAuthStatus(), registerUser()
│   ├── Skills.gs                 # 14 financial skills registry (sidebar dropdown source)
│   ├── appsscript.json           # Manifest (V8 runtime, America/New_York)
│   └── .clasp.json               # Bound to test spreadsheet (parentId: 1hzhET6...)
│
├── cloud-functions/              # GCP Cloud Functions backend (legacy, non-streaming)
│   ├── src/
│   │   ├── index.ts              # HTTP entry points: /analyze and /auth (CORS, routing)
│   │   ├── analyze.ts            # Core handler: auth → skill route → Claude call → parse → track usage
│   │   ├── skill-router.ts       # 14 skill definitions with keywords, instructions, model tiers
│   │   ├── action-parser.ts      # Extracts JSON from Claude response, validates each action
│   │   └── auth.ts               # Google OAuth token verification, Supabase user upsert
│   ├── package.json
│   └── tsconfig.json
│
├── supabase/
│   └── migrations/
│       └── 001_create_tables.sql # users, sessions, usage tables + usage_monthly view
│
├── next.config.ts                # Next.js config (minimal)
├── package.json                  # Next.js + Anthropic SDK dependencies
├── tsconfig.json                 # Strict, ES2022
└── README.md
```

## 16 Action Types

Claude returns these in the `actions[]` array. ActionExecutor.gs applies them to the spreadsheet.

| Type | Required Fields | What It Does |
|------|----------------|--------------|
| `set_value` | sheet, cell, value | Write a literal value (string/number/boolean) |
| `set_formula` | sheet, cell, formula | Write a formula (must start with `=`) |
| `format_cell` | sheet, cell, format | Apply formatting to a single cell (fontColor, background, bold, numberFormat) |
| `format_range` | sheet, range, format | Apply formatting to a range (adds verticalAlignment, horizontalAlignment, wrapStrategy, italic, fontSize) |
| `set_border` | sheet, range | Apply borders (top/bottom/left/right/vertical/horizontal booleans, style, color). Unspecified sides pass `null` (preserve existing) |
| `auto_resize_columns` | sheet, startColumn, endColumn | Auto-resize columns to fit content (batch API) |
| `add_sheet` | sheetName | Create a new tab (skips if exists) |
| `rename_sheet` | sheet, sheetName | Rename existing tab (skips if target name taken) |
| `delete_sheet` | sheet | Delete a tab (safety: skips last sheet or active sheet) |
| `add_named_range` | rangeName, rangeA1 | Create/overwrite a named range (supports `Sheet!A1` notation) |
| `activate_sheet` | sheet | Switch the active sheet (user lands here after Apply) |
| `set_column_width` | sheet, column, width | Set a column's width in pixels |
| `freeze_rows` | sheet, rows | Freeze the top N rows |
| `set_tab_color` | sheet, color | Set a sheet's tab color (hex) |
| `add_note` | sheet, cell, note | Add a note to a cell |
| `move_sheet` | sheet, position | Move a sheet to a position (1-indexed) |

Each action is independently try/caught — one failure doesn't stop the batch.

## 15 Financial Skills

Routing: explicit selection from sidebar chip → `[skill:xxx]` prefix in prompt → slash command (`/xray`, `/format`, `/prove`, `/audit`, `/explain`, `/rescan`) → keyword regex auto-detect → default (general analysis, Sonnet).

| Skill | Model | Category | Notes |
|-------|-------|----------|-------|
| Variance Analysis | Sonnet | analysis | |
| Cash Flow Forecasting | Opus | modeling | |
| Revenue Waterfall | Sonnet | analysis | |
| Expense Categorization | Sonnet | automation | |
| Unit Economics | Opus | analysis | |
| Cohort Analysis | Opus | analysis | |
| Scenario Modeling | Opus | modeling | |
| KPI Dashboard | Sonnet | reporting | |
| Investor Metrics | Sonnet | reporting | |
| Budget vs Actual | Sonnet | analysis | |
| Format & Organize | Sonnet | automation | `/format` — full workbook housekeeping or targeted formatting. Uses `format_range`, `set_border`, `auto_resize_columns`, `set_tab_color`, `move_sheet`, `delete_sheet`, `add_note` |
| Explain This Tab | Sonnet | analysis | `/explain` — structured walkthrough: purpose, inputs, calculations, outputs, connections |
| Formula X-Ray | Sonnet | analysis | `/xray` — read-only; BFS-traced hybrid payload (no full serialization). Supports multi-cell ranges. Tie-out verification |
| Prove It | Opus | analysis | `/prove` — builds auditable proof tab tracing numbers to source cells |
| Find Unused Tabs | Sonnet | automation | `/audit` — scans cross-ref graph, returns only `delete_sheet` actions for tabs safe to delete (Isolated/Empty/Scratch), ranked by cleanup value |

Sonnet skills are fast/cheap. Opus skills require deeper reasoning. **explain_tab is defined BEFORE formula_xray in `SKILL_DEFINITIONS`** — keyword iteration is array-order, so "walk me through this tab" matches explain_tab first while "walk me through this formula" matches formula_xray.

Formula X-Ray uses a different response shape — `{ type: "formula_xray", cell, sheet, raw_formula, components[], inputs[], tip, verified?, discrepancy? }` — that bypasses action validation and renders as a color-coded card. Multi-cell returns `{ type: "formula_xray", cells: [...], range_summary }`. Cross-ref graph (`getCrossRefGraphCached()`) is included on ALL paths (structural + full-context) with pre-computed `inbound` map. Cached separately (1h TTL, 50KB guard).

### Slash Commands

| Command | Skill | Example |
|---------|-------|---------|
| `/xray [cell]` | formula_xray | `/xray B14` (BFS-traced) or bare `/xray` (structural path, picks most complex) |
| `/format [instruction]` | workbook_format | `/format` (full sweep) or `/format just the header row` |
| `/prove [text]` | prove_it | `/prove show your work` |
| `/audit [instruction]` | tab_audit | `/audit` (full sweep) or `/audit just check hidden tabs` |
| `/explain [focus]` | explain_tab | `/explain` (full tab) or `/explain revenue section` |
| `/rescan` | — | Force-rebuild structural cache (no AI call) |

Slash commands set `selectedSkill` explicitly, bypassing keyword regex matching. `/xray <cell>` routes to `getFormulaXrayPayload()` → `streamXrayAnalysis()` (single-pass). Bare `/xray` falls through to structural path. `/rescan` is handled entirely in `send()` with no AI call.

## Financial Formatting Conventions (non-negotiable)

| Role | Font Color | Background | Hex | Example |
|------|-----------|------------|-----|---------|
| Hard-coded inputs | Blue | — | `#082FFF` | Revenue growth rate: 15% |
| Key model drivers | Blue | Yellow | `#082FFF` + `#FFF2CC` | Discount rate, scenario toggle |
| Formulas (all, including cross-tab) | Black | — | `#000000` | `=B2*(1+B3)`, `=Assumptions!B5` |

WorkbookState.gs detects these colors and tags cells with `role: 'input'` or `'formula'`.

## Commands

### Apps Script

```bash
cd apps-script
clasp push          # Deploy to bound spreadsheet
clasp open          # Open in Apps Script editor
clasp login         # Authenticate (first time)
```

### Vercel Backend (primary)

```bash
npm install         # Install dependencies
npm run build       # next build
npm run dev         # Local dev server on :3000
vercel --prod       # Deploy to production
vercel env ls       # List environment variables
```

### Cloud Functions (legacy)

```bash
cd cloud-functions
npm install         # Install dependencies
npm run build       # tsc → dist/
npm run deploy      # Build + deploy both /analyze and /auth to GCP
```

### Supabase

```bash
# Run migration via Supabase Dashboard SQL Editor or:
supabase db push --db-url "postgresql://postgres:[PASSWORD]@db.diselpdcsgjgetgmixhc.supabase.co:5432/postgres"
```

## Environment Variables

### Vercel (primary — set via `vercel env add`)

| Variable | Value / Source |
|----------|---------------|
| `ANTHROPIC_API_KEY` | `~/.config/secrets/anthropic-crunchy-sheets-key` |
| `SUPABASE_URL` | `https://diselpdcsgjgetgmixhc.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `~/.config/secrets/supabase-crunchy-sheets-service-key` |

Local dev uses `.env.local` with the same keys.

### Cloud Functions (legacy — set via `--set-env-vars` at deploy)

Same three variables, injected from `~/.config/secrets/` during `npm run deploy`.

## Infrastructure

| Setting | Value |
|---------|-------|
| **Vercel Project** | `brklyngg/crunchy-sheets` |
| **Production URL** | `https://crunchy-sheets.vercel.app` |
| **Sidebar VERCEL_API_BASE** | `https://crunchy-sheets.vercel.app` |
| GCP Project ID | `crunchy-sheets` |
| GCP Region | `us-central1` |
| Cloud Function Base URL | `https://us-central1-crunchy-sheets.cloudfunctions.net` |
| Supabase Ref | `diselpdcsgjgetgmixhc` |
| Supabase Region | `us-west-2` |

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
2. Sent as `Bearer` header with every `fetch()` to Vercel
3. Vercel `/api/analyze` calls Google's `/oauth2/v3/userinfo` to verify
4. User upserted into Supabase `users` table on first request

## Key Design Decisions

- **Three payload paths:** (1) Structural model (~2-5K tokens) for most requests — cached in `DocumentCache` (6h TTL), invalidated on structural changes + inline staleness check on active sheet. (2) X-Ray hybrid — structural model + BFS-traced reference chain via `buildFormulaXrayPayload()` (3 levels, 100 cells max). (3) Full serialization for 3 skills (format, prove_it, tab_audit). 120K token budget with graceful degradation, 150K hard guard.
- **Streaming via Vercel:** Sidebar calls Vercel directly via `fetch()` + `ReadableStream`. Response renders progressively. Apps Script is bypassed for the AI call (only used for workbook serialization and action execution).
- **Thinking steps:** Progressive indicators show what's happening at each phase (reading → analyzing → fetching → verifying). Appear as pills in `#messages`, auto-dismissed via `clearThinkingSteps()`. Cache warmup step auto-dismisses on hit.
- **Image input:** `+` button or drag-and-drop on input area. 4MB raw file limit (checked before base64 encoding). Sent as `imageBase64` in fetch body, Vercel wraps into multimodal content array. Bypasses Apps Script entirely.
- **Compact chat history:** `saveChatState()` stores `{role, text}` JSON objects (~50-100 bytes each) instead of raw `outerHTML` (~2-4KB each). Backward-compatible — old HTML format is discarded on first restore.
- **Slash command display:** User sees their original input (`/xray B14`) in chat, not the mutated API prompt.
- **No email display:** Auth is verified server-side on every `/api/analyze` request. Email display removed from sidebar.
- **Conversation history:** Structural-pass requests include up to 6 recent conversation entries so Claude can reference prior exchanges and avoid re-requesting already-fetched data.
- **Actions require confirmation:** Claude returns proposed actions → sidebar shows preview → user clicks "Apply All" before anything touches the spreadsheet.
- **Skill routing is layered:** Explicit sidebar selection → `[skill:xxx]` prefix → keyword auto-detect → default. Skills with `useFullContext: true` bypass structural model.
- **Model selection per skill:** Opus for complex reasoning (cash flow, unit economics, cohorts, scenarios, prove_it). Sonnet for fast analysis (variance, BvA, dashboard, categorization).
- **Onboarding:** First-use card asks user role (builder/reviewer/inherited/exploring). Saved to `UserProperties`, sent as `userRole` in every request.
- **Expanded view:** ↗ button opens a 700×750 modeless dialog via `showModelessDialog()`. Chat state transfers bidirectionally via `UserProperties` using compact JSON format.

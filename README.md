# 🥜 Crunchy Sheets

**AI CFO for Google Sheets** — by [Crunchy Numbers](https://crunchy.tools)

The financial analyst that lives in your spreadsheet. Understands workbook structure, thinks like a CFO, and applies professional formatting standards.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Google Sheets                                          │
│  ┌───────────────────────┐  ┌────────────────────────┐  │
│  │  Sidebar (HTML/JS)    │  │  Apps Script (.gs)     │  │
│  │  - Chat interface     │──│  - Menu triggers       │  │
│  │  - Skill selector     │  │  - WorkbookState       │  │
│  │  - Action confirmations│  │  - OAuth tokens       │  │
│  └───────────────────────┘  └─────────┬──────────────┘  │
└───────────────────────────────────────┼─────────────────┘
                                        │ HTTPS + Bearer token
                                        ▼
┌───────────────────────────────────────────────────────────┐
│  Cloud Functions (GCP)                                     │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │ /analyze  │  │ skill-router │  │ /auth               │  │
│  │          │──│ → 10 skills  │  │ Google token verify  │  │
│  └────┬─────┘  └──────────────┘  └──────────┬──────────┘  │
│       │                                      │             │
│       ▼                                      ▼             │
│  Claude API (Anthropic)              Supabase (Postgres)   │
│  - Sonnet 4.5 (fast)                - users                │
│  - Opus 4.6 (deep)                  - sessions             │
│                                      - usage               │
└───────────────────────────────────────────────────────────┘
```

**Core Approach: RLM (Runtime Language Model)**
- Serialize the entire workbook as a state string (cells, formulas, formatting, named ranges)
- Send it once per interaction — no RAG, no chunking, no repeated lookups
- Claude reasons over the full structure in context

## Project Structure

```
crunchy-sheets/
├── apps-script/              # Google Apps Script add-on
│   ├── Code.gs               # Menu, sidebar, backend communication
│   ├── Sidebar.html          # Chat UI with skill selector
│   ├── WorkbookState.gs      # Workbook state serialization (RLM)
│   ├── OAuth.gs              # OAuth flow handlers
│   ├── Skills.gs             # 10 financial skills registry
│   └── appsscript.json       # Manifest with OAuth scopes
├── cloud-functions/          # GCP Cloud Functions backend
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # HTTP function entry points
│       ├── analyze.ts        # Workbook analysis → Claude
│       ├── skill-router.ts   # Routes prompts to financial skills
│       └── auth.ts           # Google OAuth verification
├── supabase/
│   └── migrations/
│       └── 001_create_tables.sql
└── README.md
```

## 10 Financial Skills

| # | Skill | Model | Description |
|---|-------|-------|-------------|
| 1 | Variance Analysis | Sonnet | Budget vs actual with variance explanations |
| 2 | Cash Flow Forecasting | Opus | 13-week / 12-month cash projections |
| 3 | Revenue Waterfall | Sonnet | MRR/ARR bridge (new → expansion → churn) |
| 4 | Expense Categorization | Sonnet | Auto-classify into COGS, OpEx, CapEx |
| 5 | Unit Economics | Opus | CAC, LTV, payback period calculations |
| 6 | Cohort Analysis | Opus | Monthly retention/revenue triangular matrix |
| 7 | Scenario Modeling | Opus | Base/Optimistic/Pessimistic with SWITCH() |
| 8 | KPI Dashboard | Sonnet | Summary dashboard with SPARKLINEs |
| 9 | Investor Metrics | Sonnet | Board-ready MRR, burn rate, Rule of 40 |
| 10 | Budget vs Actual | Sonnet | Side-by-side BvA with conditional formatting |

## Setup

### Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk) (`gcloud`)
- [Node.js](https://nodejs.org) >= 20
- [clasp](https://github.com/google/clasp) for Apps Script deployment
- Access to GCP project `crunchy-sheets`

### 1. Cloud Functions Backend

```bash
cd cloud-functions
npm install
npm run build

# Deploy (requires gcloud auth)
npm run deploy
```

### 2. Supabase Database

Run the migration against your Supabase project:

```bash
# Via Supabase Dashboard → SQL Editor, paste:
# supabase/migrations/001_create_tables.sql

# Or via CLI:
supabase db push --db-url "postgresql://postgres:[PASSWORD]@db.diselpdcsgjgetgmixhc.supabase.co:5432/postgres"
```

### 3. Apps Script Add-on

```bash
# Install clasp globally
npm install -g @google/clasp

# Login to your Google account
clasp login

# Create a new Apps Script project bound to a Sheet (for testing)
clasp create --type sheets --title "Crunchy Sheets Dev"

# Push the code
cd apps-script
clasp push

# Open in browser to test
clasp open
```

### 4. Environment Variables (Cloud Functions)

| Variable | Source |
|----------|--------|
| `ANTHROPIC_API_KEY` | `~/.config/secrets/anthropic-crunchy-sheets-key` |
| `SUPABASE_URL` | `https://diselpdcsgjgetgmixhc.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `~/.config/secrets/supabase-crunchy-sheets-service-key` |

### 5. Testing Locally

```bash
cd cloud-functions
npm run serve
# Functions framework runs on http://localhost:8080

# Test the analyze endpoint:
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GOOGLE_TOKEN" \
  -d '{"workbookState": {}, "prompt": "What does this workbook do?"}'
```

## Formatting Standards

Financial analyst conventions (non-negotiable):

| Element | Font Color | Example |
|---------|-----------|---------|
| Hard-coded inputs | Blue `#0000FF` | Revenue growth rate: 15% |
| Formulas | Black `#000000` | `=B2*(1+B3)` |
| Cross-tab references | Green `#008000` | `=Assumptions!B5` |

## Pricing

| Tier | Price | Limits |
|------|-------|--------|
| Free | $0/mo | 3 analyses/month |
| Pro | $29/mo | Unlimited, all skills |
| Team | $79/mo | 5 workbooks, shared templates |
| Enterprise | Custom | Flowocity consulting bundle |

## GCP Project

- **Project ID:** `crunchy-sheets`
- **Project Number:** `930082478249`
- **Region:** `us-central1`
- **Supabase Ref:** `diselpdcsgjgetgmixhc` (us-west-2)

## License

Proprietary — Crunchy Numbers / Flowocity

# Combined Spec: X-Ray Deep Tracing + Proactive Caching + Thinking Steps + Explain Tab + Image Input

## Context

This spec merges Claude Code's "Formula X-Ray" plan with Jerome's competitive analysis recommendations. Where they conflict, this spec is authoritative. Where Claude Code's plan was sound, it's preserved. New items from the competitive analysis are added at the end.

---

## Part A: Proactive Workbook Understanding

> **ARCHITECTURAL PRINCIPLE — understand this before writing any code in Part A:**
>
> Crunchy Sheets does NOT dump the entire workbook into context. We follow the same pattern as Claude Code navigating a codebase and Claude in Excel reading sheets on-demand:
>
> 1. Build a **lightweight structural model** (the "CLAUDE.md" of the spreadsheet) — sheet names, headers, sample rows, key formulas, dependency graph. ~2-5K tokens for any workbook.
> 2. Send the structural model with every request. Claude reasons over the *shape* of the workbook.
> 3. When Claude needs actual cell data, it requests specific ranges → we fetch only those → Pass 2 answers the question.
>
> This two-pass architecture already exists (`buildStructuralModel()` in WorkbookState.gs, `getStructuralModelCached()` with CacheService, `fetchRangeData()` for Pass 2). The "proactive caching" in this part is about **warming the structural model faster and showing the user what's happening** — NOT about caching a full serialization blob.
>
> **DO NOT** store full `serializeWorkbookState()` output in `DocumentProperties` or anywhere else as a proactive cache. That approach has storage limits (9KB/property, 500KB total for DocumentProperties) and is philosophically wrong — it's the "photocopy the filing cabinet" approach we deliberately moved away from.

### A1. Warm the structural model on sidebar open

**Files:** `apps-script/Code.gs`, `apps-script/WorkbookState.gs`, `apps-script/Sidebar.html`

The existing `warmStructuralCache()` in Code.gs already calls `getStructuralModelCached()` which builds and caches the structural model in `CacheService.getDocumentCache()` (100KB limit, 6h TTL). This is the right approach. Enhance it:

**Code.gs — enhance `warmStructuralCache()` (not a new function):**
- Keep the existing logic (it already builds/caches the structural model)
- Add: return more metadata so the sidebar can show what was learned
- New return shape: `{ sheetNames, sheetCount, activeSheet, cached: boolean, buildTimeMs: number }`
- The `cached` flag tells the sidebar whether this was a cache hit or a fresh build

**Sidebar.html — enhanced init():**
- Keep calling `warmStructuralCache()` (already does)
- Show "📖 Learning your workbook..." status message in the chat area during the call (see Part E for thinking step styling)
- On completion: show brief system message "✓ Ready — read {N} tabs" then auto-dismiss after 3s
- If the structural model was already cached (`cached: true`): no visible indicator (instant)
- This gives the same UX as Claude in Excel's "Read Financial Model Summary..." steps — but honest to our architecture

### A2. Staleness check on each send()

**Files:** `apps-script/Code.gs`, `apps-script/Sidebar.html`

Before each request, do a lightweight staleness check against the **structural model** (not a full serialization cache).

**Code.gs — new `checkStaleness()` function:**
- Read current sheet names + count + active sheet name (~5ms, no serialization)
- Compare to the metadata returned by `warmStructuralCache()` (stored client-side in `cacheMeta`)
- Return `{ stale: boolean, reason: string }`
- A structural model is stale if: sheet count changed, sheet names changed, or active sheet changed

> **NOTE:** Cell-level edits do NOT make the structural model stale. The structural model captures *shape* (headers, dependencies, types), not *values*. The `onWorkbookChange` trigger already invalidates the CacheService entry on INSERT_GRID, REMOVE_GRID, RENAME — that's sufficient.

**Sidebar.html — in send():**
- Before calling `getStructuralPayload()` or `getFormulaXrayPayload()`, call `checkStaleness()`
- If stale: show "Refreshing workbook knowledge..." as a thinking step, call `warmStructuralCache()` first, then proceed
- If fresh: proceed immediately (no delay)

### A3. Manual re-trigger button

**Files:** `apps-script/Sidebar.html`

Add a "Rescan workbook" option to the existing settings gear (or as a chat command `/rescan`):
- When clicked: invalidate the structural model cache (`invalidateStructuralCache()`), then re-run `warmStructuralCache()`
- Show thinking step: "🔄 Rescanning workbook structure..." → "✓ Workbook knowledge updated ({N} tabs)"
- No confirmation dialog needed — rebuilding the structural model is fast (<1s for most workbooks, ~3s for 20+ tabs). It's not the old full serialization that took 90 seconds.

### A4. Replace "Connecting to AI..." with skill-specific labels

**Files:** `apps-script/Sidebar.html`

**CHANGE vs Claude Code's plan:** Claude Code's plan says to remove `setLoadingPhase('connecting')` entirely. Instead, we KEEP the loading phase system but replace the `'connecting'` label. The button already shows the right text — the problem is the `<span class="stream-placeholder">Connecting to AI...</span>` that appears INSIDE the chat message div before streaming starts.

In both `streamAnalysis()` and `streamStructuralAnalysis()`, replace:
```javascript
msgDiv.innerHTML = '<span class="stream-placeholder">Connecting to AI...</span>';
```
with:
```javascript
var phaseLabel = {
  formula_xray: 'Analyzing formula...',
  prove_it: 'Building proof...',
  workbook_format: 'Formatting...',
  tab_audit: 'Checking your tabs...'
}[activeSkill] || 'Thinking...';
msgDiv.innerHTML = '<span class="stream-placeholder">' + phaseLabel + '</span>';
```

Also update the `setLoadingPhase` labels map to replace `connecting: 'Thinking...'` instead of `connecting: 'Connecting to AI...'` — wait, that label is already `'Thinking...'` in the button. The in-chat placeholder is the only place that says "Connecting to AI..." and it's set directly in `streamAnalysis()` / `streamStructuralAnalysis()`. So just change those two lines.

### A5. Structural change invalidation (existing — no changes)

`onWorkbookChange()` trigger already invalidates the structural cache on INSERT_GRID, REMOVE_GRID, RENAME. Keep as-is.

---

## Part B: Formula X-Ray Speed + Multi-Cell + Deep Tracing

### B1. `apps-script/WorkbookState.gs` — Deep reference tracer

Add `buildFormulaXrayPayload(rangeNotation)`:
- Parse range notation (`Sheet!A1:B2`, `A1:B2`, `A1`)
- Read target cells: formulas, values, font colors
- **Recursively trace references** until hitting static values (inputs):
  - BFS through the formula chain
  - Level 0: Target cells (BX14, BY14)
  - Level 1: Direct refs (BX10, BX12, BX13)
  - Level 2: Their refs (BK10:BN10 — quarterly values)
  - Level N: Keep going until cells are static values
  - Cap: 3 levels deep OR 100 referenced cells (whichever first)
- For each referenced cell: value, formula (if any), header label (row 1)
- Guard: >10 target cells returns error

> **⚠️ CRITICAL:** The existing `_extractFormulaRefs` pattern won't exist — you need to write regex that handles ALL Google Sheets reference patterns: `Sheet1!A1`, `'Sheet Name'!A1:B5`, `A1`, `$A$1`, `INDIRECT("A1")` (flag INDIRECT as untraceable, don't try to resolve it). Reuse the existing `crossRefRegex` from `buildStructuralModel()` as a starting point but extend it for single-cell refs and absolute references.

Add helpers: `_extractFormulaRefs()`, `_isStaticValue()`, `_traceReferences()`, `_getHeaderLabel()`

### B2. `apps-script/Code.gs` — New entry point

Add `getFormulaXrayPayload(rangeNotation)`:
- Get cached structural model via `getStructuralModelCached()` [instant if warm]
- Build targeted cell data via `buildFormulaXrayPayload()` [~1-2s]
- Return hybrid payload: `{ structuralModel, xrayPayload, isXrayPass: true, ... }`

**Remove `formula_xray` from `fullContextSkills` map** (line ~352 in Code.gs) so `/xray` uses the new targeted path instead of full serialization.

> **⚠️ CHECK:** The `fullContextSkills` map is on line ~352: `var fullContextSkills = { workbook_format: true, prove_it: true, tab_audit: true, formula_xray: true };`. Remove `formula_xray: true` from this object. Do NOT remove the other three — they still need full context.

### B3. `lib/types.ts` — Multi-cell types

Add to existing interfaces:

```typescript
// Add to FormulaXrayData (which already exists):
export interface FormulaXrayCellData {
  cell: string;
  sheet: string;
  raw_formula: string | null;
  computed_value: any;
  summary: string;
  components: FormulaXrayComponent[];
  inputs: FormulaXrayInput[];
  verified: boolean;
  discrepancy?: string;
  tip?: string;
}

// Extend existing FormulaXrayData:
// Add optional fields:
//   cells?: FormulaXrayCellData[];
//   range_summary?: string;
//   verified?: boolean;
//   discrepancy?: string;

// Extend AnalyzeRequest:
//   xrayPayload?: any;
//   isXrayPass?: boolean;
//   imageBase64?: string;
```

### B4. `lib/skill-router.ts` — System prompt update

Update the `formula_xray` skill's `systemAddendum`. The existing prompt is good but needs three additions:

**a) Multi-cell response schema — append to existing systemAddendum:**
```
MULTI-CELL RANGES:
When analyzing a range (e.g., BX14:BY14), return:
{
  "type": "formula_xray",
  "cells": [
    { ...same fields as single-cell, plus "verified": true/false, "discrepancy": "..." },
    ...
  ],
  "range_summary": "Brief summary of how these cells relate to each other",
  "tip": "..."
}
For single cells, use the existing single-cell format (no "cells" array).
```

**b) Deep tracing instructions — append:**
```
DEEP REFERENCE TRACING:
You receive the complete reference chain — target cells and all cells they depend on, recursively traced to inputs. Use the full chain to explain how the formula builds from source data. Don't stop at "references Revenue!B2:B13" — show what those cells contain and how they feed into the result.
```

**c) Tie-out verification — append:**
```
VERIFICATION REQUIREMENT:
For each target cell, reconstruct the calculation from the referenced values you received.
- If the math ties out: set "verified": true
- If it DOES NOT tie out: set "verified": false and include "discrepancy": "Sum of inputs = 95,000 but cell shows 97,625 — difference of 2,625"
- NEVER silently accept numbers that don't add up
- For complex formulas (SUMPRODUCT, nested IFs): show the intermediate calculation steps
```

### B5. `lib/action-parser.ts` — Handle both response shapes

Update the formula_xray early return to handle both shapes:

```typescript
if (parsedJson && parsedJson.type === 'formula_xray') {
  // Multi-cell: has cells[] array
  if (Array.isArray(parsedJson.cells)) {
    return {
      actions: [],
      response: parsedJson.range_summary || '',
      rawText: claudeText,
      formulaXray: parsedJson as FormulaXrayData, // FormulaXrayData now accepts cells[]
    };
  }
  // Single-cell: existing format
  return {
    actions: [],
    response: parsedJson.summary || '',
    rawText: claudeText,
    formulaXray: parsedJson as FormulaXrayData,
  };
}
```

### B6. `app/api/analyze/route.ts` — Xray payload routing

**Token guard:** Add `body.xrayPayload` to the context string for token estimation:
```typescript
const contextStr = body.isXrayPass
  ? JSON.stringify(body.structuralModel || '') + JSON.stringify(body.xrayPayload || '')
  : body.isStructuralPass
    ? JSON.stringify(body.structuralModel || '') + JSON.stringify(body.requestedData || '') + JSON.stringify(body.conversationHistory || '')
    : JSON.stringify(body.workbookState || '');
```

**New `buildXrayUserMessage()` function:**
- Structural model (workbook understanding)
- Target cells with deep reference chain from xrayPayload
- Multi-cell instructions when >1 cell

**In the main POST handler, add before the existing isStructuralPass check:**
```typescript
const userMessage = body.isXrayPass
  ? buildXrayUserMessage(body.prompt, body.structuralModel, skillContext, body.userRole, body.xrayPayload)
  : body.isStructuralPass
    ? buildStructuralUserMessage(...)
    : buildUserMessage(...);
```

### B7. `apps-script/Sidebar.html` — UI changes

**send() function — add xray branch:**

After the existing `/xray` match block that sets `selectedSkill = 'formula_xray'`, capture the cell reference:
```javascript
var xrayMatch = text.match(/^\/xray\s*(.*)/i);
var xrayTargetCell = null;
if (xrayMatch) {
  xrayTargetCell = xrayMatch[1].trim() || null;
  text = xrayTargetCell ? 'Explain the formula in ' + xrayTargetCell : 'Explain the most complex formula';
  selectedSkill = 'formula_xray';
}
```

Then, where the payload is fetched, branch:
```javascript
if (activeSkill === 'formula_xray' && xrayTargetCell) {
  google.script.run
    .withSuccessHandler(function(payload) {
      streamXrayAnalysis(payload, fullPrompt);
    })
    .withFailureHandler(function(err) { ... })
    .getFormulaXrayPayload(xrayTargetCell);
} else {
  // existing path
  google.script.run...getStructuralPayload(fullPrompt, activeSkill || null);
}
```

> **⚠️ SCOPE ISSUE:** `xrayTargetCell` is set inside `send()` but needs to survive past the skill reset (`selectedSkill = null`). Make sure it's captured BEFORE the skill reset line, not after. The variable is local to `send()` so it's fine — just confirm the ordering.

**New `streamXrayAnalysis(payload, prompt)` function:**
- Single-pass streaming (no two-pass needed — we already have the data)
- Sends `xrayPayload` + `structuralModel` to Vercel
- Uses the thinking step UI from Part E during streaming

**Updated `renderFormulaXray(xray)` function:**
- If `xray.cells` exists (multi-cell): render range header + `range_summary` + stacked cards via `buildXrayCard()` helper
- If single cell: existing layout + tie-out indicator
- **Tie-out indicator**: Green "✓ Verified" badge or red "⚠ Discrepancy" banner
- **Discrepancy callout**: Prominent red box with `discrepancy` text, font-weight 600

**Guided form update:**
Change the `formula_xray` entry in `PALETTE_SKILLS` so `buildPrompt` returns `/xray <cell>` instead of a natural language prompt, so the `/xray` routing in `send()` picks it up correctly.

**New CSS:**
```css
.xray-verified { color: #1e8e3e; font-size: 11px; font-weight: 500; }
.xray-discrepancy { background: #fce8e6; border: 1px solid #f28b82; border-radius: 4px; padding: 8px 10px; margin-top: 6px; color: #d93025; font-size: 12px; font-weight: 600; }
.xray-multi-wrapper { display: flex; flex-direction: column; gap: 8px; }
```

---

## Part C: "Explain This Tab" Skill

### C1. `apps-script/Skills.gs` — New skill entry

Add to SKILLS array:
```javascript
{
  id: 'explain_tab',
  name: 'Explain This Tab',
  icon: '📋',
  description: 'Walk through the active tab: inputs, calculations, outputs, and purpose.',
  modelTier: 'sonnet',
  category: 'analysis',
  showInUI: true
}
```

> **⚠️ NOTE:** The existing skills don't have a `showInUI` property — the palette builds from `getSkillRegistry()` which returns ALL skills. Adding `showInUI` is fine but it won't affect anything unless you also filter on it in `buildPalette()`. Just add the skill to the array without `showInUI` — it'll appear in the palette like all the others.

### C2. `apps-script/Sidebar.html` — Guided form

Add to `PALETTE_SKILLS`:
```javascript
explain_tab: {
  placeholder: 'What should I focus on?',
  fields: [
    { key: 'focus', label: 'Focus area (optional)', type: 'text', placeholder: 'e.g. revenue section, rows 10-25' }
  ],
  hint: 'Leave blank for a full tab walkthrough',
  buttonLabel: 'Explain',
  buildPrompt: function(vals) {
    var focus = vals.focus ? vals.focus.trim() : '';
    var base = 'Walk me through the structure of the active tab. Summarize the key inputs, calculations, and outputs. Explain any important relationships between sections and the overall purpose of this tab.';
    return focus ? base + ' Focus on: ' + focus : base;
  }
}
```

### C3. `lib/skill-router.ts` — Add routing

> **⚠️ ADDITION vs Claude Code's plan:** Claude Code said "No backend skill-router entry needed — routes as general analysis." That's WRONG for our architecture. Without a skill definition in skill-router.ts, the `explain_tab` keyword won't be recognized and the prompt won't get the right instruction prepended. Add:

```typescript
{
  id: 'explain_tab',
  modelTier: 'sonnet',
  maxTokens: 4096,
  keywords: /explain\s+(this\s+)?tab|walk\s+me\s+through\s+(this\s+)?tab|what('s| is)\s+(this\s+|the\s+)?tab\s+(for|about|doing)/i,
  instruction: 'Walk through the active tab: identify the key inputs (hard-coded values), calculations (formulas), outputs (summary rows/columns), and explain the tab\'s purpose in the workbook.',
  systemAddendum: `
EXPLAIN TAB MODE:
Structure your response as:
1. **Purpose** — What this tab does in one sentence
2. **Inputs** — Key hard-coded values (blue font cells) that drive calculations
3. **Calculations** — How the tab transforms inputs into outputs (key formula patterns)
4. **Outputs** — The bottom-line numbers or summaries this tab produces
5. **Connections** — Which other tabs feed into or consume from this one

Keep it concise. A CFO should be able to read this in 30 seconds and understand the tab's role.`,
}
```

---

## Part D: Screenshot / Image Input in Chat

### D1. `apps-script/Sidebar.html` — Drag-and-drop + file input

**Input area changes (next to Send button):**
- Add a `+` button (attachment icon) that opens a hidden `<input type="file" accept="image/*">`
- Add drag-and-drop handlers on the `.input-area`:
  - `dragover` → show drop zone overlay ("Drop image here")
  - `drop` → read file via `FileReader.readAsDataURL()` → store as `pendingImage`
- Show thumbnail preview of attached image below the input area (max 60px height)
- Clear `pendingImage` after send or on ✕ click

**In `send()` function:**
- If `pendingImage` exists, include `imageBase64` field in the payload sent to Vercel
- Pass through to both `streamAnalysis()` and `streamStructuralAnalysis()` fetch calls
- Clear `pendingImage` after sending

**CSS:**
```css
.attach-btn {
  background: none; border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; padding: 6px 8px; font-size: 14px; color: var(--text-secondary);
}
.attach-btn:hover { background: var(--accent-light); color: var(--accent); }
.image-preview {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px;
  background: #f8f8f8; border-radius: 4px; margin-top: 4px; font-size: 11px;
}
.image-preview img { max-height: 60px; border-radius: 3px; }
.image-preview .remove-image { cursor: pointer; color: var(--text-secondary); }
.drop-zone-overlay {
  position: absolute; inset: 0; background: rgba(15,81,50,0.08);
  border: 2px dashed var(--accent); border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent); font-size: 12px; font-weight: 500; z-index: 10;
  pointer-events: none;
}
```

### D2. `app/api/analyze/route.ts` — Multimodal message support

Accept optional `imageBase64` in request body. When present, build multimodal content:
```typescript
const content = body.imageBase64
  ? [
      { type: 'image' as const, image: body.imageBase64 },
      { type: 'text' as const, text: userMessage }
    ]
  : userMessage;

// In the streamText call:
messages: [{ role: 'user', content }],
```

> **⚠️ SIZE GUARD:** Add a size check before processing: `if (body.imageBase64 && body.imageBase64.length > 5_000_000) return new Response('Image too large (max 4MB)', { status: 413 })`. Claude's vision API has a ~5MB limit on base64 images.

### D3. `lib/types.ts` — Add image field

Add `imageBase64?: string` to `AnalyzeRequest`.

---

## Part E: Thinking Steps (NEW — from competitive analysis)

> **This was not in Claude Code's plan.** This is the #1 priority recommendation from the competitive analysis. Claude in Excel shows every tool call as a collapsible step. We adapt this to our two-pass architecture.

### E1. `apps-script/Sidebar.html` — Step indicator UI

**New component: thinking steps area.**

Between the typing indicator and the streaming message, show collapsible "step pills" that narrate what Crunchy Sheets is doing:

```html
<div class="thinking-steps" id="thinkingSteps">
  <!-- Populated dynamically -->
</div>
```

**JavaScript — `addThinkingStep(icon, label, status)` function:**
```javascript
function addThinkingStep(icon, label, status) {
  var container = document.getElementById('thinkingSteps');
  if (!container) return;
  var step = document.createElement('div');
  step.className = 'thinking-step ' + (status || 'active');
  step.innerHTML = '<span class="step-icon">' + icon + '</span> ' +
    '<span class="step-label">' + escapeHtml(label) + '</span>' +
    (status === 'done' ? ' <span class="step-check">✓</span>' : ' <span class="step-spinner"></span>');
  container.appendChild(step);
  scrollToBottom();
  return step;
}

function completeThinkingStep(stepEl) {
  if (!stepEl) return;
  stepEl.className = 'thinking-step done';
  var spinner = stepEl.querySelector('.step-spinner');
  if (spinner) spinner.outerHTML = '<span class="step-check">✓</span>';
}

function clearThinkingSteps() {
  var container = document.getElementById('thinkingSteps');
  if (container) container.innerHTML = '';
}
```

**Integration points — add steps during the existing flow:**

1. **`warmStructuralCache()` callback in init():** `addThinkingStep('📖', 'Read workbook structure (' + meta.sheetCount + ' tabs)', 'done')`

2. **In `send()`, after `setLoading(true)`:**
   - `addThinkingStep('📄', 'Reading workbook data...', 'active')` → complete when `getStructuralPayload` returns

3. **In `streamStructuralAnalysis()`, when Pass 1 starts streaming:**
   - Complete the "reading" step
   - `addThinkingStep('🧠', 'Analyzing structure...', 'active')`

4. **In `streamStructuralAnalysis()`, when data_request is detected:**
   - Complete the "analyzing" step
   - For each range in `dataRequest.ranges`: `addThinkingStep('📊', 'Fetching ' + range.sheet + '!' + range.range, 'active')` → complete when `fetchRangeData` returns

5. **In `streamStructuralAnalysis()`, Pass 2 starts:**
   - `addThinkingStep('✍️', 'Generating response...', 'active')` → complete when stream ends

6. **For X-Ray specifically:**
   - `addThinkingStep('🔬', 'Reading ' + cellRef + '...', 'active')`
   - `addThinkingStep('🔗', 'Tracing formula chain (' + N + ' levels deep)...', 'active')`
   - `addThinkingStep('✅', 'Verifying math...', 'active')`

7. **On stream complete or error:** `clearThinkingSteps()`

**CSS:**
```css
.thinking-steps {
  padding: 4px 0;
}
.thinking-step {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 10px; font-size: 11px; color: var(--text-secondary);
  line-height: 1.6;
}
.thinking-step.done { color: #1e8e3e; }
.thinking-step .step-icon { font-size: 12px; }
.thinking-step .step-check { color: #1e8e3e; font-weight: 600; }
.thinking-step .step-spinner {
  display: inline-block; width: 10px; height: 10px;
  border: 1.5px solid var(--border); border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
```

> **KEY DIFFERENCE from Claude in Excel:** They show tool_use calls because they use Claude's tool_use API. We show our two-pass flow steps because that's what actually happens. Same trust-building effect, but honest to our architecture.

---

## Part F: "Ask Before Edits" Visibility (NEW — from competitive analysis)

### F1. `apps-script/Sidebar.html` — Reassurance toggle

Below the input area, add a subtle footer line:
```html
<div class="edit-guard-note">✓ Always asks before making changes</div>
```

This is NOT a functional toggle (our Apply All / Cancel flow already handles this). It's purely a trust signal for nervous finance users who see the sidebar for the first time.

**CSS:**
```css
.edit-guard-note {
  font-size: 10px; color: #1e8e3e; text-align: center;
  padding: 4px 0 0; opacity: 0.7;
}
```

---

## Part G: Expandable Reasoning (NEW — from competitive analysis)

### G1. `apps-script/Sidebar.html` — "How I got this" collapsible

For analysis-type responses (no actions, just text), add a collapsible section below the response:

**When rendering the finalized message (in `finalizeStreamedMessage`):**
- If the response came from a structural pass AND we have `conversationHistory` entries with `fetchedRanges`:
  - Add a "How I got this ▸" toggle below the response text
  - On expand: show which sheets were read, which ranges were fetched, and the model used
  - This data is already available — we just need to capture it and render it

**Implementation:**
```javascript
function addReasoningCollapsible(msgDiv, metadata) {
  if (!metadata || !metadata.sheetsRead) return;
  var details = document.createElement('details');
  details.className = 'reasoning-collapsible';
  details.innerHTML = '<summary>How I got this ▸</summary>' +
    '<div class="reasoning-content">' +
    '<div><strong>Sheets examined:</strong> ' + metadata.sheetsRead.join(', ') + '</div>' +
    (metadata.rangesFetched ? '<div><strong>Data pulled:</strong> ' + metadata.rangesFetched.join(', ') + '</div>' : '') +
    '<div><strong>Model:</strong> ' + (metadata.model || 'Sonnet') + '</div>' +
    '</div>';
  msgDiv.appendChild(details);
}
```

**CSS:**
```css
.reasoning-collapsible { margin-top: 6px; font-size: 11px; }
.reasoning-collapsible summary { cursor: pointer; color: var(--text-secondary); user-select: none; }
.reasoning-collapsible summary:hover { color: var(--accent); }
.reasoning-content { padding: 6px 0 0 12px; color: var(--text-secondary); line-height: 1.6; }
```

> **⚠️ SCOPE:** This is lower priority than Parts A-E. If the changeset is getting too large, defer Part G to a follow-up PR. But do NOT defer Part E (thinking steps) — that's the highest-impact item.

---

## Execution Order

1. **WorkbookState.gs** — `buildFormulaXrayPayload()` + deep tracing helpers
2. **Code.gs** — `getFormulaXrayPayload()`, `warmFullCache()`, `checkStaleness()`, remove xray from `fullContextSkills`
3. **Skills.gs** — add `explain_tab` skill entry
4. **types.ts** — multi-cell types, verified/discrepancy fields, xrayPayload, imageBase64
5. **skill-router.ts** — add `explain_tab` definition + multi-cell + deep tracing + tie-out in formula_xray system prompt
6. **action-parser.ts** — handle array response shape
7. **route.ts** — xray branch + `buildXrayUserMessage()` + multimodal image support
8. **Sidebar.html** — ALL UI changes:
   - Part A: proactive caching, staleness check, manual rescan, replace "Connecting to AI..."
   - Part B: branched xray send, streaming, multi-cell renderer, tie-out indicators
   - Part C: explain_tab guided form
   - Part D: image drag-and-drop + attachment button + thumbnail preview
   - **Part E: thinking steps** (new — integrate into existing streaming flow)
   - Part F: edit guard note (one line of HTML + CSS)
   - Part G: reasoning collapsible (if scope allows)
9. **Build + deploy:** `npm run build` → `clasp push` → test

---

## Verification

**X-Ray (Part B):**
1. `/xray B14` — single cell, <5s to first token, tie-out checkmark
2. `/xray BX14:BY14` — stacked cards, range_summary, deep reference chain
3. `/xray` bare — structural path (no regression)
4. Deep tracing: SUM of SUMs shows quarterly breakdown
5. Tie-out: deliberate mismatch → red warning with specific discrepancy text

**Structural Model Warming (Part A):**
6. Sidebar open (cache expired): "Learning your workbook..." thinking step visible, then "✓ Ready — read N tabs"
7. Sidebar open (cache fresh): instant, no indicator
8. `/rescan` command: invalidates cache → rebuilds structural model → "Workbook knowledge updated"
9. Staleness: add a sheet → next send() shows "Refreshing workbook knowledge..." thinking step
10. No "Connecting to AI..." text anywhere
11. Full serialization (`serializeWorkbookState()`) is NEVER called proactively — only on-demand for skills that need it (`workbook_format`, `prove_it`, `tab_audit`)

**Explain Tab (Part C):**
11. Click "Explain This Tab" in palette → guided form → pre-filled prompt → tab walkthrough
12. Verify skill-router picks up the keyword pattern

**Image Input (Part D):**
13. Drag screenshot into chat → thumbnail preview → send with message → Claude references the image
14. Click + button → file picker → attach image → same flow
15. Send without image → normal text-only request (no regression)
16. Image >4MB → error message (not silent failure)

**Thinking Steps (Part E):**
17. Any query: step pills appear during processing, clear when response renders
18. Two-pass query: see "Reading workbook data ✓" → "Analyzing structure ✓" → "Fetching P&L!A1:F30 ✓" → "Generating response..."
19. X-Ray query: see "Reading B14 ✓" → "Tracing formula chain ✓" → "Verifying math ✓"
20. Steps don't persist after response is complete

**Edit Guard (Part F):**
21. "✓ Always asks before making changes" visible below input area

**Reasoning (Part G):**
22. Analysis response shows "How I got this ▸" collapsible with sheets + ranges

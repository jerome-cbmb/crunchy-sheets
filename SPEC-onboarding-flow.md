# Spec: Crunchy Sheets Onboarding Flow

**Author:** Jerome  
**Date:** 2026-02-18  
**Status:** Ready for Claude Code

---

## Problem

New users open the sidebar and see a blank chat with a vague system message and three generic prompt buttons. There's no moment of "oh, this understands my spreadsheet" and no guidance on who the tool is for. Role selection is buried in settings. First-time experience is dead air.

## Goal

Give new users a short, elegant 2-screen flow that:
1. Tells them what Crunchy Sheets does (without a wall of text)
2. Delivers immediate value — the AI already talking about *their* workbook before they've typed anything

The key differentiator from Claude in Excel: **we end with the AI already talking**, not "you're set up, go ahead and type."

**Removed: role picker screen.** Role selection wasn't meaningful enough customization to justify a dedicated step. It stays in ⚙️ Settings for users who want it. The conversation itself shapes Claude's responses better than a self-classification picker.

---

## Scope

- **Files changed:** `Sidebar.html` only
- **No new Apps Script functions required** — uses existing `warmStructuralCache()` and the existing `/api/analyze` streaming endpoint
- **New Apps Script function needed:** `markOnboardingComplete()` and `isOnboardingComplete()` (2 trivial UserProperties wrappers — add to `Code.gs`)
- **No new screens or dialogs** — everything lives inline in the sidebar, replacing the existing `checkOnboarding()` flow

---

## Implementation Plan

### 1. State Detection

Replace `checkOnboarding()` with logic that checks a `onboardingComplete` UserProperties key.

```js
// Called once on init (after warmStructuralCache resolves)
function checkOnboarding() {
  google.script.run
    .withSuccessHandler(function(complete) {
      if (!complete) {
        showOnboardingScreen1();
      } else {
        // Existing flow: pre-select role in settings, show example prompts
        loadRoleAndShowExamples();
      }
    })
    .isOnboardingComplete();
}
```

**New Apps Script functions (add to Code.gs):**
```js
function isOnboardingComplete() {
  return PropertiesService.getUserProperties().getProperty('onboardingComplete') === 'true';
}

function markOnboardingComplete() {
  PropertiesService.getUserProperties().setProperty('onboardingComplete', 'true');
}
```

---

### 2. Screen 1 — Welcome

**Trigger:** First open, no `onboardingComplete` flag.

**Replaces:** The existing `messages` div content. Inject a full-width overlay `div#onboardingScreen` positioned over the chat area.

**Layout:**
```
┌─────────────────────────────────────┐
│  [header row stays — title + buttons]
├─────────────────────────────────────┤
│                                     │
│         [Crunchy Sheets logo]       │  ← existing SVG from header
│                                     │
│   Your AI analyst, built into       │
│   the spreadsheet.                  │
│                                     │
│   Ask questions, verify formulas,   │
│   clean up formatting — without     │
│   leaving Google Sheets.            │
│                                     │
│   ┌─────────────────────────────┐   │
│   │     Get started →           │   │
│   └─────────────────────────────┘   │
│                                     │
│   Already set up? [Skip]            │
└─────────────────────────────────────┘
```

**Details:**
- White background, centered content, `padding: 24px 20px`
- Logo: reuse the `<svg>` from the header but render it larger (32×32), with the `#0F5132` stroke
- Headline: 20px, font-weight 500
- Subtext: 13px, `var(--text-secondary)`, line-height 1.6
- CTA button: full-width, `var(--accent)` green, same style as `.btn-apply`
- Skip link: small, `var(--text-secondary)`, skips to existing example prompts flow and marks onboarding complete

**On click "Get started →":** `showOnboardingScreen2()` *(now the First Look screen — no role picker)*

---

### 3. Screen 2 — First Look (Auto-Loading)

This screen fires immediately after "Get started →" is clicked, while the AI is generating the first response. Replaces the onboarding div with the normal chat view, then triggers an AI workbook summary automatically.

**Sequence:**
1. Remove the onboarding overlay — reveal the normal chat UI
2. Mark onboarding complete (`markOnboardingComplete()`)
3. Inject a "Reading your workbook..." thinking step
4. Fire the workbook summary request (using existing streaming architecture)
5. The first message the user sees is an AI-generated workbook summary

**Prompt sent to `/api/analyze`:**
```
[onboarding_summary] Give me a brief, friendly introduction to this workbook. In 2-3 short paragraphs:
- What is this workbook? (infer from structure, sheet names, and data)
- What are the key tabs I should know about?
- What's the most useful thing I can ask you about it?
Keep it conversational, specific to the actual content, and under 150 words.
```

*(No role framing — keep it neutral. Role selection is available in ⚙️ Settings for users who want it.)*

**UX during load:**
- Show thinking steps: "📚 Reading your workbook..." → "🧠 Generating your intro..."
- These use the existing `addThinkingStep()` + `clearThinkingSteps()` pattern
- Normal typing indicator while streaming

**After the first message arrives:**
- Show the standard 3 example prompt cards below the AI message (existing `showExamplePrompts()`)
- The input area is already active — user can type immediately

---

## CSS — New Styles Needed

Add to the existing `<style>` block:

```css
/* ─── Onboarding ─────────────────────────────────────────────── */
.onboarding-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px 20px 24px;
  background: var(--bg-warm);
  min-height: calc(100vh - 80px);
}

.onboarding-logo {
  margin-bottom: 20px;
}

.onboarding-headline {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 10px;
  line-height: 1.3;
}

.onboarding-subtext {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 28px;
  max-width: 280px;
}

.onboarding-cta {
  width: 100%;
  max-width: 280px;
  padding: 12px 24px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: 16px;
}

.onboarding-cta:hover { background: #0a3d25; }

.onboarding-skip {
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  text-decoration: underline;
  background: none;
  border: none;
}

.onboarding-skip:hover { color: var(--accent); }

/* Screen 2: Role picker */
/* No role picker styles needed — role selection is settings-only */
```

---

## Modified `checkOnboarding()` function (full replacement)

```js
function checkOnboarding() {
  google.script.run
    .withSuccessHandler(function(complete) {
      if (!complete) {
        showOnboardingScreen1();
      } else {
        loadRoleAndShowExamples();
      }
    })
    .isOnboardingComplete();
}

function loadRoleAndShowExamples() {
  google.script.run
    .withSuccessHandler(function(role) {
      var currentRole = role || 'exploring';
      var radios = document.querySelectorAll('input[name="userRole"]');
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].value === currentRole) radios[i].checked = true;
      }
      showExamplePromptsForRole(currentRole);
    })
    .getUserRole();
}
```

---

## New JS functions (add to Sidebar.html `<script>` block)

```js
function showOnboardingScreen1() {
  var container = document.getElementById('messages');
  container.innerHTML = '';

  var screen = document.createElement('div');
  screen.className = 'onboarding-screen';
  screen.id = 'onboardingScreen';

  screen.innerHTML =
    '<div class="onboarding-logo">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>' +
        '<line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>' +
      '</svg>' +
    '</div>' +
    '<div class="onboarding-headline">Your AI analyst,<br>built into the spreadsheet.</div>' +
    '<div class="onboarding-subtext">Ask questions, verify formulas, clean up formatting — without leaving Google Sheets.</div>' +
    '<button class="onboarding-cta" onclick="showOnboardingScreen2()">Get started →</button>' +
    '<button class="onboarding-skip" onclick="skipOnboarding()">Already set up? Skip</button>';

  container.appendChild(screen);
}

function showOnboardingScreen2() {
  // Reveal normal chat UI
  var container = document.getElementById('messages');
  container.innerHTML =
    '<div class="message system">Analyze financial models, explain formulas, build forecasts, and clean up formatting.</div>';

  // Mark onboarding complete
  google.script.run.markOnboardingComplete();

  // Fire workbook summary
  var summaryPrompt = '[onboarding_summary] Give a brief, friendly introduction to this workbook. In 2-3 short paragraphs: what is this workbook, what are the key tabs, and what\'s the most useful thing I can ask you about it? Keep it specific to the actual content, conversational, and under 150 words.';

  // Show thinking steps while loading
  showTypingIndicator();
  addThinkingStep('📚', 'Reading your workbook...');
  setLoading(true, 'analyzing');

  // Fetch workbook summary using two-pass structural path
  google.script.run
    .withSuccessHandler(function(payload) {
      streamOnboardingSummary(payload);
    })
    .withFailureHandler(function(err) {
      setLoading(false);
      clearThinkingSteps();
      removeTypingIndicator();
      addMessage('Welcome! Your workbook is loaded. What would you like to know?', 'assistant');
      showExamplePrompts();
    })
    .getStructuralPayload(summaryPrompt, null);
}

async function streamOnboardingSummary(payload) {
  var msgDiv = createStreamingMessage();
  addThinkingStep('🧠', 'Generating your intro...');

  try {
    var response = await fetch(VERCEL_API_BASE + '/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + payload.token
      },
      body: JSON.stringify({
        structuralModel: payload.structuralModel,
        prompt: payload.prompt,
        spreadsheetId: payload.spreadsheetId,
        userEmail: payload.userEmail,
        userRole: payload.userRole,
        isStructuralPass: true
      })
    });

    if (!response.ok) {
      throw new Error(response.status);
    }

    msgDiv.innerHTML = '';
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var accumulated = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      accumulated += decoder.decode(chunk.value, { stream: true });
      updateStreamingMessage(msgDiv, accumulated);
      scrollToBottom();
    }

    setLoading(false);
    clearThinkingSteps();
    removeStreamingIndicator(msgDiv);

    // Parse and display (plain text — no actions expected)
    var parsed = parseStreamedResponse(accumulated);
    msgDiv.innerHTML = renderMarkdown(escapeHtml(parsed.response || accumulated));

    // Show standard example prompts below the intro
    showExamplePrompts();

  } catch (err) {
    setLoading(false);
    clearThinkingSteps();
    removeStreamingIndicator(msgDiv);
    if (msgDiv.parentNode) msgDiv.remove();
    addMessage('Welcome! Your workbook is loaded. What would you like to know?', 'assistant');
    showExamplePrompts();
  }
}

function skipOnboarding() {
  google.script.run.markOnboardingComplete();
  loadRoleAndShowExamples();
}
```

---

## Edge Cases & Constraints

### Re-onboarding
- Don't re-trigger onboarding if `onboardingComplete` is set, even if `getUserRole()` returns null (role could have been cleared accidentally)
- Add a "Reset onboarding" option in settings panel (small link at bottom) that clears the flag — useful for testing + power users who want to switch personas

### Workbook too small / no data
- If `cacheMeta.sheetCount === 0` or the workbook scan fails: skip the summary fetch, show a friendly static message: *"This looks like a blank workbook. Open a financial model to get started."*
- Detect via the `warmStructuralCache` response (check `sheetCount`)

### Cache timing
- `checkOnboarding()` is called at the end of the `init()` IIFE — by that time, `warmStructuralCache()` is already in-flight
- The structural model call in `showOnboardingScreen3()` will benefit from the cache if it's ready; if not, it'll build it (same as a regular first message)
- No special ordering needed — the race condition resolves fine because `getStructuralPayload` builds the cache if missing

### Skip flow
- Skip should behave exactly like a returning user: pre-select `exploring` in settings, show generic example prompts, **no summary generation**

### Settings panel reset
- After onboarding completes, the settings panel ⚙ button still works to change role
- When role changes via settings after onboarding: `saveRoleSetting()` already handles it, no additional onboarding state needed

### Dialog (expanded) mode
- The expanded view (`openExpandedView()`) loads the same Sidebar.html with `isDialogMode = true`
- If chat history is present (chat was restored), skip onboarding even if `onboardingComplete` is false
- Add to `restoreChatState()`: if messages were restored, also call `markOnboardingComplete()` silently

---

## What NOT to Build

- No progress bar or step indicators (1 of 3 etc.) — adds complexity, doesn't add value for a 3-screen flow
- No animation/transitions beyond the card hover + brief selected flash
- No "back" button on screen 2 — the flow is linear and short
- No server-side changes — this is pure frontend + 2 trivial Apps Script functions
- Don't A/B test or personalize the first message further — ship it, see if users engage

---

## Verification

After implementation, manually test:

1. **New user path:** Open sidebar → see welcome screen → click "Get started →" → see "Reading your workbook..." thinking steps → see AI-generated workbook summary → see standard example prompts. Input is active and usable.
2. **Skip path:** Click "Already set up? Skip" → goes directly to normal chat with example prompts. No summary generated.
3. **Returning user path:** Close and reopen sidebar → skips all onboarding, shows normal chat + example prompts immediately.
4. **Chat restore:** Open in dialog mode with existing chat history → skips onboarding regardless of flag state.
5. **Blank workbook:** New blank spreadsheet → summary generation returns gracefully with a static welcome message.
6. **Role in settings:** Change role in ⚙ settings at any time → applies to all future requests. Not touched during onboarding.

# Quick-Win UX Improvements Spec
*For Phase 1 (pre-marketplace launch)*

**Target timeline:** 45 min total implementation (15+10+20)
**Target deployment:** Before Feb 21 marketplace submission
**Branch:** `feat/quick-wins-ux`

---

## Overview
Three low-risk, high-value UX improvements to Crunchy Sheets Sidebar:
1. Slash command autocomplete enhancements (15 min)
2. Role option tooltips (10 min)
3. Skill description tooltips on palette hover (20 min)

---

## #1: Slash Command Autocomplete Enhancements (15 min)

**Current behavior:**
- User types `/` → slash menu appears with matching commands
- Commands show: `cmd` | `desc`
- Tab or click to select

**Improvements:**
- Highlight matching text in the command name (e.g., `/xa` → `/[xa]ray`)
- Show keyboard hint next to menu: "Tab to complete" (once)
- Keep current active item styling (blue highlight)
- Do NOT change the actual slash command matching logic

**Files to modify:** `apps-script/Sidebar.html`

**Specific changes:**
1. In `handleSlashAutocomplete()` function (line ~1470), before rendering the menu:
   - Keep all existing logic
   - When rendering each match item (line ~1485), enhance the innerHTML to include `<mark>` tags around the matched portion of the command
   - Example: If user typed `/exp`, render `/[exp]lain` by wrapping the "exp" part in `<mark>` tags
   - Add CSS: `.slash-item mark { font-weight: bold; background: rgba(15, 81, 50, 0.15); }`

2. Keep the active item indicator (i === 0 ? ' active' : '')

3. Test cases:
   - `/x` → matches `/xray`
   - `/prov` → matches `/prove`
   - `/` → matches all 6 commands
   - `/z` → no matches, menu closes

---

## #2: Role Option Tooltips (10 min)

**Current behavior:**
- 4 radio buttons with labels: "Builder", "Reviewer", "Inherited", "Exploring"
- Descriptions in plain text next to each: "focuses on...", "emphasizes...", etc.
- Text wraps on narrow displays

**Improvements:**
- Add title attribute (native tooltip) to each radio label
- Title text = the current description text
- On hover, show full description in browser tooltip
- No visual changes needed

**Files to modify:** `apps-script/Sidebar.html`

**Specific changes:**
1. Find role radio buttons (line ~1348)
   ```html
   <label class="settings-option">
     <input type="radio" name="userRole" value="builder" onchange="saveRoleSetting(this.value)">
     <strong>Builder</strong> — focuses on formula logic and model structure
   </label>
   ```

2. For each role, add `title` attribute to the label:
   ```html
   <label class="settings-option" title="Focuses on formula logic and model structure">
     <input type="radio" name="userRole" value="builder" onchange="saveRoleSetting(this.value)">
     <strong>Builder</strong> — focuses on formula logic and model structure
   </label>
   ```

3. Repeat for: "Reviewer", "Inherited", "Exploring"

4. Test: Hover over each radio button label → browser tooltip appears

---

## #3: Skill Description Tooltips on Palette Hover (20 min)

**Current behavior:**
- Palette dropdown shows 14 skills + "Ask anything"
- Each skill displays: icon | name on top, description on bottom (2 lines)
- Text wraps
- Descriptions are ~50–100 chars

**Improvement:**
- Make full description available on hover as a tooltip
- Use native `title` attribute or custom CSS-based tooltip
- NO change to palette item layout/styling
- Keep existing description text in the UI

**Why:** Some descriptions are truncated or hard to read on hover; full context helps users understand each skill better.

**Files to modify:** `apps-script/Sidebar.html`

**Specific changes:**
1. Find `buildPalette()` function (line ~3383)

2. Locate where palette items are created (line ~3392):
   ```javascript
   var item = document.createElement('div');
   item.className = 'palette-item';
   item.dataset.id = skill.id;
   item.innerHTML =
     '<div class="palette-item-info">' +
       '<div class="palette-item-name">' + (skill.icon ? skill.icon + ' ' : '') + escapeHtml(skill.name) + '</div>' +
       '<div class="palette-item-desc">' + escapeHtml(skill.description || '') + '</div>' +
     '</div>';
   ```

3. Add title attribute to the item div:
   ```javascript
   item.title = escapeHtml(skill.description || 'Click to use ' + skill.name);
   ```

4. Alternative (better for longer descriptions): Add title to the info div instead:
   ```javascript
   var info = document.createElement('div');
   info.className = 'palette-item-info';
   info.title = escapeHtml(skill.description || 'Click to use ' + skill.name);
   // ... then append name and desc children
   ```

5. Test:
   - Hover over "Formula X-Ray" → tooltip shows full description
   - Hover over "Prove It" → tooltip shows "Ask it to prove..."
   - Hover over "Ask anything" → shows "Free-form question about your workbook"
   - Click on skill → opens guided form or focuses input (existing behavior unchanged)

---

## Testing Checklist

- [ ] Slash commands highlight matching text
- [ ] Role buttons show tooltip on hover
- [ ] All 14 skills show tooltip on palette hover
- [ ] No regression: All existing slash command behavior works (Tab, Enter, clicking)
- [ ] No regression: All existing skill selection behavior works
- [ ] No regression: Chat messages still render correctly
- [ ] Mobile: Tooltips don't break on narrow screens (title attributes are mobile-safe)

---

## Rollback Plan

- If any improvement breaks slash menu or palette rendering:
  - Git revert commit
  - Deploy backup from main branch
  - Note the specific failure for next iteration

---

## Notes

- **Risk level:** LOW — All three improvements are CSS/attribute only, no functional logic changes
- **No scope creep:** Don't change command matching logic, palette layout, or guidance forms
- **Browser compatibility:** title attributes and mark tags work in all browsers (including Google Sheets embedded context)
- **Performance:** Negligible — only adds string attributes, no event listeners or re-renders

# Crunchy Sheets — Google Workspace Marketplace Submission Checklist

## Google Workspace Marketplace Requirements

This checklist maps Google's required + recommended assets to what we have ready.

### ✅ REQUIRED

**1. App Name & Description**
- [ ] App name: "Crunchy Sheets — AI CFO for Google Sheets"
- [ ] Short description (< 80 chars): "Financial analyst in your spreadsheet"
- [ ] Long description (< 4000 chars): [NEEDS WRITTEN]
- [ ] Category: Finance / Accounting

**2. Icons & Images**
- [ ] App icon (128×128 px): [CHECK marketplace-assets/]
- [ ] Logo (300×300 px): [CHECK marketplace-assets/]
- [ ] Tile image (640×400 px): [✅ banner-220x140.png]
- [ ] Video thumbnail (640×360 px): [USE video frame]
- [ ] Demo video (< 30 sec): [✅ demo-5sec.mp4]

**3. Privacy & Security**
- [ ] Privacy policy URL: https://crunchy.tools/privacy
- [ ] Data usage statement: [VERIFY]
- [ ] OAuth scopes: [✅ in appsscript.json]

**4. Support & Contact**
- [ ] Support email: [TBD]
- [ ] Developer name: Gary Gurevich / Crunchy Numbers
- [ ] Developer website: https://crunchy.tools
- [ ] Support URL: https://github.com/brklyngg/crunchy-sheets

---

## What We Have Ready

### ✅ Assets
```
marketplace-assets/
├── banner-220x140.png
├── demo-5sec.mp4
├── demo-5sec-square.mp4
└── frame_01.png → frame_24.png (24 total screenshots)
```

### 🟡 Needs Review
- Long-form description (positioning copy from Gary)
- Support email address
- Privacy policy verification
- Screenshot selection (top 3-5 frames)

---

## Submission Workflow (10 minutes)

1. **Get approval** on description + screenshot picks
2. **Log into** Google Workspace Marketplace Developer Console
3. **Create new app** → "Crunchy Sheets"
4. **Upload assets**: banner, demo video, 3-5 screenshots, icons
5. **Fill form fields**:
   - App name
   - Short + long descriptions
   - Support email & URLs
   - Privacy policy URL
   - Category: Finance
6. **Add pricing info**: Free (3/mo) → Pro ($29/mo)
7. **Submit for review**
8. **Google approves** within 3-7 days

---

## Blockers to Clear

1. **Long-form description** (4000 chars) — key positioning: "Proof tab is the differentiator"
2. **Support email** — which crunchy.tools email?
3. **Privacy policy** — live at https://crunchy.tools/privacy?
4. **Screenshot picks** — which 3-5 best showcase the value?

Once cleared → submit in 10 min.

---

## Post-Submission (v2.0)

- Implement SPEC-xray-caching-thinking-steps.md optimizations
- Monitor approval status in developer console
- Prepare LinkedIn launch announcement
- Watch for user feedback on "Proof" tab positioning

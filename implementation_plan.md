# UI Refresh – Premium Design

## Goal
Upgrade the portal UI to a modern, premium look:
- Dark mode toggle with smooth transition.
- Glassmorphism panels (sidebar, cards, login card).
- Google Font (Inter) for typography.
- Micro‑animations on buttons, nav chips, hover effects.
- Responsive layout adjustments.

## User Review Required
> [!IMPORTANT] Please confirm:
> - Do you want a **manual dark‑mode toggle** (button in the top‑bar) or rely solely on the OS `prefers-color-scheme` media query?
> - Should the glass‑morphism effect be applied to **all panels** (`.panel`, `.topbar`, `.login-card-single`, etc.) or only specific sections?
> - Any specific accent color palette you prefer (e.g., teal‑blue, purple‑pink)?

## Proposed Changes

### 1. HTML (`index.html`)
- Add a `<link>` to Google Font **Inter**.
- Insert a dark‑mode toggle button in the top‑bar (if user opts for manual toggle).

### 2. CSS (`styles.css`)
- Define CSS variables for **light** and **dark** themes under `:root` and `[data-theme="dark"]`.
- Add `@media (prefers-color-scheme: dark)` fallback.
- Apply glass‑morphism styles (`background: rgba(255,255,255,0.12); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.18); border-radius: var(--radius-lg);`).
- Update typography to use `font-family: 'Inter', system-ui, sans-serif;`.
- Add transition `transition: background 0.3s, color 0.3s, transform 0.2s;` to major UI components.
- Enhance button hover/active states with subtle scale (`transform: scale(1.02)`) and shadow changes.
- Add a `.dark-mode` class on `<html>` to switch themes via JS.

### 3. JavaScript (`app.js`)
- On load, detect saved theme in `localStorage` or OS preference.
- Provide `toggleTheme()` function bound to the new button.
- Update `document.documentElement.dataset.theme = 'dark' | 'light'` to trigger CSS.
- Ensure existing UI re‑renders after theme change (call `render()`).

### 4. Responsive Adjustments
- Media query for sidebar collapse below `768px`.
- Ensure glass panels adapt to dark background.

### 5. Accessibility
- Preserve focus outlines, add `aria-pressed` to the toggle button.
- Ensure sufficient contrast in both themes.

## Open Questions
> [!WARNING] **Theme Preference**: Manual toggle vs. OS‑only?
> **Accent Palette**: Keep existing `--accent` (blue) or switch to teal?

## Verification Plan
### Automated Tests
- Run `npm run build` (or `npm start`) and check that the DOM contains `data-theme="dark"` when toggled.
- Verify that the login card has a glass‑morphism background (`rgba` with blur).
### Manual Verification
1. Load the app, toggle dark mode, observe smooth transition.
2. Hover over buttons/nav chips – ensure subtle scaling and shadow.
3. Resize the window to < 768 px – sidebar should collapse.
4. Confirm Google Font loads (inspect computed `font-family`).
5. Check contrast ratios with a tool (e.g., Chrome devtools).

---
*Please review the plan and answer the open questions so we can proceed with the implementation.*

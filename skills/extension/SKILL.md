# Extension Skill

- Use Chromium Manifest V3. The Side Panel is the entire application UI.

- Content scripts own page interaction: user-initiated mining mode, selection/hover capture, relevant-text detection, and page lifecycle cleanup.

- Use explicit message contracts between content scripts, background/service worker where needed, and Side Panel. Keep page data untrusted and validate it at the backend boundary.

- Request only the permissions required for Side Panel, active-page capture, and local backend communication. Document every new permission.

- Do not place dictionary, JLPT, SQLite, or AnkiConnect logic in extension code. Send capture context to the FastAPI API and render returned card drafts.

- Make capture non-destructive and resilient to navigation, iframe limitations, missing selections, and extension reloads.

- The content script must not assume that the current page is a specific subtitle player or website. Capture logic should operate on generic page text/selection primitives, with site-specific behavior added only as a justified future extension.
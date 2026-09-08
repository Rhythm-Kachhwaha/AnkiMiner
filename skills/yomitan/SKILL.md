# Yomitan Skill

- All Yomitan access goes through `YomitanService`; no direct calls elsewhere.
- Default endpoint: `http://127.0.0.1:19633`, with configuration kept at the integration boundary.
- Treat tokenization and dictionary lookup as separate operations. Normalize provider request/response formats into application-level terms such as expression, reading, and meanings.
- Handle unavailable service, HTTP errors, malformed responses, and contract changes gracefully.
- `/serverVersion` is known to work with POST; `/tokenize` works. `/termEntries` previously returned HTTP 500 for a test request, so establish its exact request contract before relying on it.
- Do not leak endpoint names, request fields, or raw payloads into routes, UI, or persistence code.

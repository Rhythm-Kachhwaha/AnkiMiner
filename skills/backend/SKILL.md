# Backend Skill

- Use Python and FastAPI. Organize routes around validated API schemas and services around application behavior/provider boundaries.
- Routes validate input and return stable application-level responses; services own orchestration. Do not expose raw Yomitan or AnkiConnect contracts as the extension API.
- Follow local-first behavior: persist cards in SQLite before Anki synchronization and represent pending/failed sync explicitly.
- Keep error handling actionable: distinguish invalid input, unavailable local dependencies, and unexpected provider failures without losing a card.
- Keep the first slice narrow and testable. Do not add speculative infrastructure or cloud dependencies.
- Keep provider integrations behind dedicated services (`YomitanService`, `AnkiConnectService`, `JLPTService`) and keep database access behind a database/repository boundary. Business services should depend on these boundaries rather than constructing provider clients or SQL inline.
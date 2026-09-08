# Database Skill

- SQLite is the local source of truth for cards, their lifecycle/sync state, duplicate identity, and local history.
- Database code owns schema definitions, migrations/versioning when introduced, transactions, and constraints. Keep SQL/persistence details out of routes and UI.
- Persist before Anki sync. Model pending and failed sync states so no card is lost.
- Store and enforce the proposed duplicate identity: normalized expression + reading + deck. Normalize consistently in one backend-owned location.
- Use transactions for operations that must atomically save card state and duplicate checks; preserve data through external-service failures.

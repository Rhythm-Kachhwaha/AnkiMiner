# Anki Skill

- Encapsulate AnkiConnect behind a dedicated service. Default endpoint: `http://127.0.0.1:8765`.
- Own note creation, deck handling, external duplicate checks, sync result translation, and retries/pending synchronization at this boundary.
- Save the card locally first. An AnkiConnect outage or rejection must leave a recoverable local card marked pending or failed.
- Check Anki when necessary as well as SQLite, preventing duplicates after a SQLite reset. Use normalized expression + reading + deck identity.
- AnkiConnect is part of normal operation; do not create a setup wizard. Endpoint configuration may be exposed only for diagnostics/future flexibility.

# Testing Skill

- Use a practical pyramid for this small local-first app: focused backend unit tests, boundary integration tests, extension behavior tests where practical, and manual cross-process smoke tests.
- Unit-test normalization, duplicate identity, lifecycle transitions, validation, and provider-response normalization.
- Integration-test Yomitan and AnkiConnect boundaries with controlled fixtures/mocks and, when available, explicit local-service smoke checks.
- Test extension capture/message behavior where practical, including missing selection, navigation, and unavailable backend states.
- Manually smoke-test the vertical path: capture -> identification -> Side Panel display, then later save -> pending/synced Anki behavior.
- Never mark work complete without verification. Record what ran, what passed, and any unverified limitation in `PROGRESS.md`.

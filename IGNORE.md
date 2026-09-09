# Files and Directories to Ignore

Agents should not read, modify, or consider the following files/directories as part of the codebase:

## Build Artifacts & Cache
- `__pycache__/` - Python bytecode cache
- `*.pyc`, `*.pyo` - Compiled Python files
- `.pytest_cache/` - Pytest cache
- `.coverage` - Coverage reports
- `htmlcov/` - HTML coverage reports

## Test Output & Temporary Files
- `*.json` (in root) - Test output files (e.g., `capture_result.json`, `termentries_result.json`, `tokenize_result.json`)
- `structure.txt` - Generated structure dump
- `test_*.py` (in root) - Standalone test scripts not part of test suite

## IDE & Editor
- `.vscode/` - VS Code settings
- `.idea/` - IntelliJ IDEA settings
- `*.swp`, `*.swo` - Vim swap files

## OS Generated
- `.DS_Store` - macOS metadata
- `Thumbs.db` - Windows thumbnails

## Logs
- `*.log`
- `logs/`

## Virtual Environments
- `venv/`, `env/`, `.venv/`
- `pip-wheel-metadata/`

## Distribution
- `dist/`, `build/`
- `*.egg-info/`

## Documentation (unless explicitly requested)
- `*.md` files not in project root or docs/ (e.g., random markdown files)

## Scripts (unless explicitly requested)
- `*.py` files in root that are not part of the backend package (e.g., `extract_examples.py`, `inspect_structure.py`)

## AnkiMiner Specific
- Backend tests should be in `backend/tests/` only
- Extension tests should be in `extension/tests/` only
- Root-level Python files are typically throwaway scripts
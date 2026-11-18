# Scripts

Start and stop the app in Docker. Run from anywhere; they work relative to the repo root.

- `start.sh` (Mac, Linux) / `start.ps1` (Windows): build the `pm` image, replace any existing `pm` container, run it detached on port 8000 with `--env-file .env` and the `pm-data` volume at `/app/data`
- `stop.sh` / `stop.ps1`: remove the `pm` container if it exists

Windows may block unsigned scripts; run with `powershell -ExecutionPolicy Bypass -File scripts\start.ps1`.

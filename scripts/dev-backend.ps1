# Start the backend for local dev on port 8000.
#
# Why a script: Google OAuth requires the redirect URI to match an
# "Authorized redirect URI" in Google Cloud Console *exactly*, including the
# port. Only http://localhost:8000/api/v1/auth/google/callback is registered,
# so the backend must be reached as localhost:8000.
#
# Real environment variables take precedence over backend/.env (pydantic-settings),
# so this overrides a stale BACKEND_BASE_URL there without editing the file.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts/dev-backend.ps1
#
# Check the config first with: python scripts/check_oauth_config.py

$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot '..\backend'

$env:BACKEND_BASE_URL = 'http://localhost:8000'
$env:FRONTEND_BASE_URL = 'http://localhost:5173'
$env:PORT = '8000'

Push-Location $backend
try {
    python -m uvicorn main:app --reload --port 8000
} finally {
    Pop-Location
}

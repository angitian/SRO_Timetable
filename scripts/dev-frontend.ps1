# Start the Vite dev server pointed at the local backend (http://localhost:8000).
#
# Must be `localhost`, not 127.0.0.1: the Google redirect URI registered in the
# OAuth client is http://localhost:8000/..., and localStorage (the stored JWT)
# is per-origin — mixing the two hosts makes the user look logged out.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts/dev-frontend.ps1

$ErrorActionPreference = 'Stop'
$frontend = Join-Path $PSScriptRoot '..\frontend'

$env:VITE_API_URL = 'http://localhost:8000'

Push-Location $frontend
try {
    npm run dev
} finally {
    Pop-Location
}

#!/usr/bin/env bash
set -euo pipefail

#
# Robin Automated Preflight Regression Test Runner (Maestro)
#
# Verifies critical features prior to app deployment:
#   1. Authentication (login if necessary)
#   2. Feed Refresh (top bar action & feed reload)
#   3. Post Compose (open compose modal, verify UI, cancel safely)
#   4. Feed Mode Switching (switch to 'For You', verify reload, switch back)
#
# Usage:
#   ./scripts/run-preflight-test.sh [device_id]
#
# Examples:
#   ./scripts/run-preflight-test.sh
#   ./scripts/run-preflight-test.sh emulator-5554
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Load secrets from external or ignored locations
if [[ -f "$HOME/.sidekick-secrets/robin-test-credentials.env" ]]; then
  echo "Loading test credentials from ~/.sidekick-secrets/robin-test-credentials.env"
  # shellcheck source=/dev/null
  source "$HOME/.sidekick-secrets/robin-test-credentials.env"
elif [[ -f "$PROJECT_DIR/.env.local" ]]; then
  echo "Loading test credentials from .env.local"
  # shellcheck source=/dev/null
  source "$PROJECT_DIR/.env.local"
elif [[ -f "$PROJECT_DIR/.env" ]]; then
  echo "Loading test credentials from .env"
  # shellcheck source=/dev/null
  source "$PROJECT_DIR/.env"
fi

# 2. Verify required environment variables
MISSING_VARS=()
[[ -z "${X_TEST_USERNAME:-}" ]] && MISSING_VARS+=("X_TEST_USERNAME")
[[ -z "${X_TEST_PASSWORD:-}" ]] && MISSING_VARS+=("X_TEST_PASSWORD")
[[ -z "${X_TEST_TOTP_URL:-}" ]] && MISSING_VARS+=("X_TEST_TOTP_URL")

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
  echo "Error: Missing required environment variable(s): ${MISSING_VARS[*]}"
  echo ""
  echo "Please set them in ~/.sidekick-secrets/robin-test-credentials.env or .env.local"
  echo "See .env.example for variable templates."
  exit 1
fi

# 3. Detect or resolve target test device (Android emulator preferred for this preflight)
DEVICE_ID="${1:-}"
if [[ -z "$DEVICE_ID" ]]; then
  if command -v adb &>/dev/null; then
    ANDROID_DEVICE=$(adb devices | grep -E '\b(device)\b' | head -n 1 | awk '{print $1}')
    if [[ -n "$ANDROID_DEVICE" ]]; then
      DEVICE_ID="$ANDROID_DEVICE"
    fi
  fi

  if [[ -z "$DEVICE_ID" ]] && command -v xcrun &>/dev/null; then
    IOS_DEVICE=$(xcrun simctl list devices | grep -E '\(Booted\)' | head -n 1 | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' || true)
    if [[ -n "$IOS_DEVICE" ]]; then
      DEVICE_ID="$IOS_DEVICE"
    fi
  fi
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "Error: No active Android emulator or booted iOS simulator detected."
  echo "Please start an emulator/simulator or specify a device ID: ./scripts/run-preflight-test.sh <device_id>"
  exit 1
fi

echo "=========================================================="
echo "Robin Preflight Regression Suite"
echo "Target Device: $DEVICE_ID"
echo "=========================================================="

# 4. Fetch fresh TOTP code
echo "Fetching fresh 2FA TOTP code for authentication guard..."
export X_TEST_TOTP_URL
TOTP_CODE="$("$SCRIPT_DIR/fetch-totp.py")"

if [[ -z "$TOTP_CODE" || ${#TOTP_CODE} -ne 6 ]]; then
  echo "Error: Failed to obtain valid 6-digit TOTP code."
  exit 1
fi

echo "TOTP code retrieved successfully (6 digits)."

# 5. Run Maestro Preflight Flow
echo "Executing Maestro preflight regression flow (e2e/preflight.yaml)..."
maestro --device "$DEVICE_ID" test "$PROJECT_DIR/e2e/preflight.yaml" \
  -e USERNAME="$X_TEST_USERNAME" \
  -e PASSWORD="$X_TEST_PASSWORD" \
  -e TOTP="$TOTP_CODE"

echo ""
echo "=========================================================="
echo "✅ Preflight Regression Test Passed Successfully on $DEVICE_ID!"
echo "   - Auth state verified (login-if-needed passed)"
echo "   - Feed refresh verified"
echo "   - New post compose verified & cancelled"
echo "   - Feed mode switched to 'For You' & verified"
echo "   - Feed mode switched to 'Following (by time)' & verified"
echo "=========================================================="

#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo "   Roview CLI & Companion End-to-End Test Harness"
echo "========================================================"

PORT=3299
TEMP_DIR=$(mktemp -d /tmp/roview-e2e-XXXXXX)
DATA_PATH="$TEMP_DIR/proposals.json"
TOKEN="e2e-token-shell-runner-0123456789"
PAIRING="e2e-pair-code"

cleanup() {
  echo "--> Cleaning up background server & temp files..."
  if [ -n "${COMPANION_PID:-}" ] && kill -0 "$COMPANION_PID" 2>/dev/null; then
    kill "$COMPANION_PID" 2>/dev/null || true
    wait "$COMPANION_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_DIR"
  echo "✔ Done cleanup."
}
trap cleanup EXIT

echo "--> 1. Starting isolated Roview companion on port $PORT..."
ROVIEW_PORT=$PORT \
ROVIEW_DATA_PATH="$DATA_PATH" \
ROVIEW_TOKEN="$TOKEN" \
ROVIEW_PAIRING_CODE="$PAIRING" \
pnpm start > "$TEMP_DIR/server.log" 2>&1 &
COMPANION_PID=$!

# Wait for server to become healthy
for i in {1..30}; do
  if curl -s "http://127.0.0.1:$PORT/healthz" | grep -q '"status":"ok"'; then
    echo "✔ Companion server is healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "❌ Failed to connect to companion server within 6s. Server log:"
    cat "$TEMP_DIR/server.log"
    exit 1
  fi
  sleep 0.2
done

export ROVIEW_TOKEN="$TOKEN"
export ROVIEW_URL="http://127.0.0.1:$PORT"

echo "--> 2. Running CLI doctor check..."
pnpm cli doctor | grep -q "Companion reachable"
echo "✔ CLI doctor check passed."

echo "--> 3. Checking initial proposal list (must be empty)..."
pnpm cli list | grep -q "No proposals."
echo "✔ Initial list is clean."

echo "--> 4. Submitting daily-reward fixture proposal via CLI..."
SUBMIT_OUT=$(pnpm cli submit packages/fixtures/proposals/daily-reward.json)
echo "   Output: $SUBMIT_OUT"
echo "$SUBMIT_OUT" | grep -q "demo_daily_reward r1"
echo "✔ Proposal submitted successfully."

echo "--> 5. Checking proposal status via CLI..."
STATUS_OUT=$(pnpm cli status demo_daily_reward 1)
echo "   Output: $STATUS_OUT"
echo "$STATUS_OUT" | grep -q "READY_FOR_REVIEW"
echo "✔ Proposal status is READY_FOR_REVIEW."

echo "--> 6. Cancelling proposal via CLI..."
CANCEL_OUT=$(pnpm cli cancel demo_daily_reward 1)
echo "   Output: $CANCEL_OUT"
echo "$CANCEL_OUT" | grep -q "CANCELLED"
echo "✔ Proposal cancelled successfully."

echo "--> 7. Deleting terminal proposal data via CLI..."
pnpm cli data-delete --yes | grep -q "Deleted 1 local proposal record"
echo "✔ Proposal data purged."

echo "--> 8. Testing setup CLI with policy pack generation..."
POLICY_TARGET="$TEMP_DIR/policy-test"
pnpm setup:mcp -- --client cursor --mode companion --token "$TOKEN" --policy-target "$POLICY_TARGET" --apply >/dev/null
if [ -f "$POLICY_TARGET/.cursor/rules/roview.mdc" ]; then
  echo "✔ Policy pack generated correctly."
else
  echo "❌ Policy pack missing."
  exit 1
fi

echo "========================================================"
echo "   All Roview CLI & Companion E2E Harness Tests Passed! 🎉"
echo "========================================================"

#!/usr/bin/env bash
# GitHub main 에 새 커밋이 올라오면 서버를 업데이트 (systemd 타이머가 5분마다 실행)
#   기록 보기: sudo journalctl -u mungle-update -n 50
set -euo pipefail
APP="${MUNGLE_APP:-/opt/mungle}"
BRANCH="${MUNGLE_BRANCH:-main}"
LOCAL="$(sudo -u mungle -H git -C "$APP" rev-parse HEAD)"
REMOTE="$(sudo -u mungle -H git -C "$APP" ls-remote --quiet origin "refs/heads/$BRANCH" | cut -f1)"
[ -n "$REMOTE" ] || { echo "GitHub 확인 실패 — 다음에 다시 시도"; exit 0; }
[ "$LOCAL" != "$REMOTE" ] || exit 0
# 한 번 실패한 커밋은 다시 빌드하지 않음 (새 커밋이 올라오면 다시 시도)
FAILED_MARK=/var/lib/mungle/.update-failed
[ "$(cat "$FAILED_MARK" 2>/dev/null || true)" != "$REMOTE" ] || exit 0
echo "새 버전 발견: ${LOCAL:0:7} → ${REMOTE:0:7}"
if bash "$APP/deploy/update.sh"; then rm -f "$FAILED_MARK"; else echo "$REMOTE" > "$FAILED_MARK"; exit 1; fi

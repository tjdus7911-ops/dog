#!/usr/bin/env bash
# 멍글마을 업데이트: GitHub main 최신 코드로 바꾸고 다시 시작 (데이터는 그대로)
#   sudo bash /opt/mungle/deploy/update.sh
#
# 안전하게 바꾸기:
#   1) 지금 돌아가는 서버는 그대로 둔 채, 복사본(/opt/mungle.next)에서 새 코드를 받아 빌드
#   2) 빌드가 성공했을 때만 잠깐 멈추고 폴더를 바꿔 끼움 (몇 초)
#   3) 새 버전이 켜지지 않으면 바로 이전 버전으로 되돌림
# 데이터(/var/lib/mungle)와 설정(/etc/mungle.env)은 손대지 않음.
set -euo pipefail
APP="${MUNGLE_APP:-/opt/mungle}"
NEXT="$APP.next"
PREV="$APP.prev"
BRANCH="${MUNGLE_BRANCH:-main}"
PORT="$(grep -E '^PORT=' /etc/mungle.env 2>/dev/null | cut -d= -f2 || true)"
HEALTH="http://127.0.0.1:${PORT:-3001}/api/health"
as_app() { sudo -u mungle -H bash -c "$1"; }
# 코드 폴더는 mungle 사용자 소유 → git 도 그 사용자로 (root로 하면 git이 소유자 불일치로 거부)
git_app() { sudo -u mungle -H git "$@"; }
healthy() { for _ in $(seq 1 40); do curl -fsS "$HEALTH" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행해 주세요."; exit 1; }
# 자동 업데이트와 손으로 하는 업데이트가 겹치지 않게
exec 9>/run/mungle-update.lock
flock -n 9 || { echo "다른 업데이트가 진행 중이에요."; exit 0; }

OLD="$(git_app -C "$APP" rev-parse --short HEAD)"
echo "🐾 새 코드 준비 (지금: $OLD)"
rm -rf "$NEXT"
cp -a "$APP" "$NEXT"
as_app "cd '$NEXT' && git fetch --quiet origin '$BRANCH' && git reset --quiet --hard 'origin/$BRANCH'"
NEW="$(git_app -C "$NEXT" rev-parse --short HEAD)"
if [ "$OLD" = "$NEW" ] && [ "${1:-}" != "--force" ]; then
  echo "🐾 이미 최신이에요 ($NEW)"; rm -rf "$NEXT"; exit 0
fi
# 의존성이 바뀐 경우에만 다시 설치 (빌드 시간 절약)
if ! cmp -s "$APP/package-lock.json" "$NEXT/package-lock.json" || [ ! -d "$NEXT/node_modules" ]; then
  as_app "cd '$NEXT' && npm ci --include=dev --no-audit --no-fund"
fi
if ! as_app "cd '$NEXT' && npm run build"; then
  echo "❌ 새 버전 빌드 실패 — 지금 버전($OLD)을 그대로 씁니다."; rm -rf "$NEXT"; exit 1
fi

echo "🐾 바꿔 끼우기 $OLD → $NEW"
systemctl stop mungle 9>&-
rm -rf "$PREV"
mv "$APP" "$PREV"
mv "$NEXT" "$APP"
systemctl start mungle 9>&-
if healthy; then
  echo "🐾 업데이트 완료 ($NEW)"
else
  echo "❌ 새 버전이 켜지지 않아 이전 버전($OLD)으로 되돌립니다. 로그: sudo journalctl -u mungle -n 80"
  systemctl stop mungle 9>&-
  rm -rf "$APP.failed"; mv "$APP" "$APP.failed"; mv "$PREV" "$APP"
  systemctl start mungle 9>&-
  healthy && echo "🐾 이전 버전으로 복구됨" || echo "❌ 복구도 실패 — 로그를 확인해 주세요."
  exit 1
fi

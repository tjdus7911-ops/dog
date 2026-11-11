#!/usr/bin/env bash
# GitHub 에 새 커밋이 올라오면 서버를 업데이트 (systemd 타이머가 5분마다 실행)
#   기록 보기: sudo journalctl -u mungle-update -n 50
# 따라가는 브랜치: MUNGLE_BRANCH (기본 main). 그 브랜치가 GitHub 에서 지워지면 main 으로 넘어감
set -euo pipefail
APP="${MUNGLE_APP:-/opt/mungle}"
BRANCH="${MUNGLE_BRANCH:-main}"
# 저장소의 deploy/branch 가 있으면 그 브랜치를 따라감 (서버에 접속하지 않고 따라갈 브랜치를 바꾸기 위함)
if [ -f "$APP/deploy/branch" ]; then B="$(tr -d '[:space:]' < "$APP/deploy/branch")"; [ -z "$B" ] || BRANCH="$B"; fi
git_app() { sudo -u mungle -H git "$@"; }

# 추가 주소(도메인): 저장소의 deploy/domains (한 줄에 하나) 를 Caddy 에 반영 — 5분마다 확인, 바뀐 경우에만 적용
apply_domains() {
  local list="$APP/deploy/domains" cf=/etc/caddy/Caddyfile base names tmp
  [ -f "$list" ] || return 0
  base="$(sed -n 's|^https://||p' /root/mungle-url.txt 2>/dev/null | head -1)"
  names="$( { [ -n "$base" ] && echo "$base"; grep -Eo '^[a-z0-9.-]+\.[a-z]{2,}' "$list"; } | awk '!seen[$0]++' | paste -sd, - | sed 's/,/, /g')"
  [ -n "$names" ] || return 0
  tmp="$(mktemp)"
  printf '%s {\n  encode gzip\n  reverse_proxy 127.0.0.1:3001\n}\n' "$names" > "$tmp"
  if cmp -s "$tmp" "$cf"; then rm -f "$tmp"; return 0; fi
  cp "$cf" "$cf.bak"
  if caddy validate --adapter caddyfile --config "$tmp" >/dev/null 2>&1; then
    install -m 644 "$tmp" "$cf"
    if systemctl reload caddy; then echo "주소 반영: $names"; else cp "$cf.bak" "$cf"; systemctl reload caddy || true; echo "주소 반영 실패 — 이전 설정으로 되돌림"; fi
  else echo "주소 설정 검사 실패 — 그대로 둠"; fi
  rm -f "$tmp"
}
apply_domains || true
LOCAL="$(git_app -C "$APP" rev-parse HEAD)"
REMOTE="$(git_app -C "$APP" ls-remote --quiet origin "refs/heads/$BRANCH" | cut -f1 || true)"
if [ -z "$REMOTE" ] && [ "$BRANCH" != main ]; then
  REMOTE="$(git_app -C "$APP" ls-remote --quiet origin refs/heads/main | cut -f1 || true)"
  [ -z "$REMOTE" ] || { echo "브랜치 $BRANCH 가 없어 main 을 따라갑니다"; BRANCH=main; }
fi
[ -n "$REMOTE" ] || { echo "GitHub 확인 실패 — 다음에 다시 시도"; exit 0; }
[ "$LOCAL" != "$REMOTE" ] || exit 0
# 한 번 실패한 커밋은 다시 빌드하지 않음 (새 커밋이 올라오면 다시 시도)
FAILED_MARK=/var/lib/mungle/.update-failed
[ "$(cat "$FAILED_MARK" 2>/dev/null || true)" != "$REMOTE" ] || exit 0
echo "새 버전 발견 ($BRANCH): ${LOCAL:0:7} → ${REMOTE:0:7}"
if MUNGLE_BRANCH="$BRANCH" bash "$APP/deploy/update.sh"; then rm -f "$FAILED_MARK"; else echo "$REMOTE" > "$FAILED_MARK"; exit 1; fi

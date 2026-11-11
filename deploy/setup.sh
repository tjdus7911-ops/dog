#!/usr/bin/env bash
# 멍글마을 서버 설치 스크립트 (Ubuntu 22.04 / 24.04, ARM·x86 모두 가능 — 오라클 클라우드 무료 VM 기준)
#
# 사용법 (서버에 SSH로 접속한 뒤 한 줄 실행):
#   curl -fsSL https://raw.githubusercontent.com/tjdus7911-ops/dog/main/deploy/setup.sh | sudo bash -s -- "" "운영자 이름" "연락 이메일"
#   - 첫 번째 값: 도메인 (비워 두면 서버 IP로 무료 주소 <IP>.sslip.io 를 자동으로 사용)
#   - 두 번째·세 번째 값: 이용약관/개인정보 처리방침에 표시할 운영자 이름과 연락처
#   - 네 번째 값(선택): 운영자(관리 화면) 아이디, 쉼표로 여러 개
#   - (선택) 서버 밖 백업: 실행 전에 MUNGLE_GITHUB_REPO=소유자/저장소, MUNGLE_GITHUB_TOKEN=토큰 을 export 해 두면
#     DB·강아지 사진을 그 비공개 저장소에도 자동 저장 (서버가 통째로 사라져도 새 서버에서 되살림)
#
# 하는 일: Node.js 22·Caddy 설치 → 코드 내려받기·빌드 → 서비스 등록(자동 재시작) → HTTPS 자동 발급 → 방화벽 80/443 열기
#          → GitHub main 에 새 코드가 올라오면 5분 안에 자동 업데이트
# 다시 실행해도 안전합니다. 데이터(/var/lib/mungle)와 설정(/etc/mungle.env)은 덮어쓰지 않습니다.
set -euo pipefail

DOMAIN="${1:-}"
OPERATOR="${2:-}"
CONTACT="${3:-}"
ADMINS="${4:-}"
GH_REPO="${MUNGLE_GITHUB_REPO:-}"
GH_TOKEN="${MUNGLE_GITHUB_TOKEN:-}"
REPO="${MUNGLE_REPO:-https://github.com/tjdus7911-ops/dog.git}"
# 설치·자동 업데이트에 쓸 브랜치 (이전 작업 중에는 oracle-move, 그 브랜치가 없어지면 자동으로 main)
BRANCH="${MUNGLE_BRANCH:-main}"
APP=/opt/mungle
DATA=/var/lib/mungle
ENVFILE=/etc/mungle.env
export DEBIAN_FRONTEND=noninteractive

[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행해 주세요."; exit 1; }
say() { printf '\n\033[1;35m🐾 %s\033[0m\n' "$*"; }

# 설치 진행 상황을 SSH 없이 브라우저로 확인 (MUNGLE_STATUS=1 일 때만):
#   설치하는 동안 http://<서버IP>:443/ 에 설치 기록 끝부분을 보여 주고, HTTPS 설정 직전에 끔.
#   설치가 중간에 실패하면 계속 켜 두어 원인을 볼 수 있음.
STATUS_PIDS=""
if [ "${MUNGLE_STATUS:-}" = 1 ] && command -v python3 >/dev/null; then
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  mkdir -p /run/mungle-status
  ( while true; do { date -u; free -m | head -2; echo; tail -n 120 /var/log/mungle-setup.log 2>/dev/null; } > /run/mungle-status/status.tmp; mv -f /run/mungle-status/status.tmp /run/mungle-status/index.txt; sleep 3; done ) &
  STATUS_PIDS="$!"
  ( cd /run/mungle-status && exec python3 -m http.server 443 >/dev/null 2>&1 ) &
  STATUS_PIDS="$STATUS_PIDS $!"
  trap 'echo "❌ 설치가 줄 $LINENO 에서 멈췄어요"' ERR
fi
stop_status() { [ -n "$STATUS_PIDS" ] && kill $STATUS_PIDS 2>/dev/null || true; STATUS_PIDS=""; }

# 화면(클라이언트) 빌드: 저장소에 같은 소스로 미리 빌드한 결과(client/dist/.src)가 있으면 그대로 쓰고,
# 없으면 메모리를 아껴 Vite 빌드만 (서버 타입 검사는 실행에 필요 없어 생략 — 작은 VM에서 메모리 부족 방지)
build_client() {
  local dir="$1" want
  want="$(sudo -u mungle -H git -C "$dir" rev-parse HEAD:client/src)-$(sudo -u mungle -H git -C "$dir" rev-parse HEAD:shared)"
  if [ -f "$dir/client/dist/.src" ] && [ "$(cat "$dir/client/dist/.src")" = "$want" ]; then
    echo "   미리 빌드된 화면 사용 ($want)"; return 0
  fi
  sudo -u mungle -H bash -c "cd '$dir/client' && NODE_OPTIONS=--max-old-space-size=1400 npx vite build"
}

say "1/8 기본 패키지 설치"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https

# 메모리가 작은 VM(1GB)에서도 설치·빌드가 되도록 스왑 3GB 확보
if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 2000 ] && ! swapon --show | grep -q .; then
  say "메모리가 작아 스왑 3GB를 만듭니다"
  fallocate -l 3G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "2/8 Node.js 22 설치"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

say "3/8 Caddy(HTTPS 웹서버) 설치"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

say "4/8 코드 내려받기·빌드"
id mungle >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/mungle --shell /usr/sbin/nologin mungle
mkdir -p "$DATA" && chown mungle:mungle "$DATA"
# 코드 폴더는 mungle 사용자 소유 — git 도 그 사용자로 실행 (root 로 하면 소유자 불일치로 거부됨)
if [ ! -d "$APP/.git" ]; then git clone -b "$BRANCH" "$REPO" "$APP"; fi
chown -R mungle:mungle "$APP"
sudo -u mungle -H git -C "$APP" pull --ff-only origin "$BRANCH"
sudo -u mungle -H bash -c "cd '$APP' && npm ci --include=dev --no-audit --no-fund"
build_client "$APP"

say "5/8 서비스 등록"
if [ ! -f "$ENVFILE" ]; then
  cat > "$ENVFILE" <<ENV
# 멍글마을 서버 설정 — 바꾼 뒤: sudo systemctl restart mungle
PORT=3001
NODE_ENV=production
MUNGLE_DATA_DIR=$DATA
MUNGLE_TRUST_PROXY=1
MUNGLE_PARK_CAPACITY=30
MUNGLE_BACKUP_HOURS=24
MUNGLE_OPERATOR=$OPERATOR
MUNGLE_CONTACT=$CONTACT
# 운영자(관리 화면) 아이디, 쉼표로 여러 개
MUNGLE_ADMINS=$ADMINS
# AI 강아지 사진 분석을 쓰려면 키 입력 (유료 API)
ANTHROPIC_API_KEY=
ENV
  chmod 600 "$ENVFILE"
else
  if [ -n "$OPERATOR" ]; then sed -i "s|^MUNGLE_OPERATOR=.*|MUNGLE_OPERATOR=$OPERATOR|" "$ENVFILE"; fi
  if [ -n "$CONTACT" ]; then sed -i "s|^MUNGLE_CONTACT=.*|MUNGLE_CONTACT=$CONTACT|" "$ENVFILE"; fi
  if [ -n "$ADMINS" ]; then sed -i "s|^MUNGLE_ADMINS=.*|MUNGLE_ADMINS=$ADMINS|" "$ENVFILE"; fi
fi
# 서버 밖 백업(선택): 값이 들어온 경우에만 기록. 이 서버는 디스크가 남으므로 '서버 DB가 없을 때만' 저장소에서 되살림
setenv() { if grep -q "^$1=" "$ENVFILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENVFILE"; else echo "$1=$2" >> "$ENVFILE"; fi; }
setenv MUNGLE_BRANCH "$BRANCH"
if [ -n "$GH_REPO" ] && [ -n "$GH_TOKEN" ]; then
  setenv MUNGLE_GITHUB_REPO "$GH_REPO"
  setenv MUNGLE_GITHUB_TOKEN "$GH_TOKEN"
  setenv MUNGLE_GITHUB_RESTORE missing
  echo "   서버 밖 백업 사용: $GH_REPO"
fi

cat > /etc/systemd/system/mungle.service <<UNIT
[Unit]
Description=Mungle Village (멍글마을)
After=network-online.target
Wants=network-online.target

[Service]
User=mungle
WorkingDirectory=$APP
EnvironmentFile=$ENVFILE
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable mungle >/dev/null
systemctl restart mungle

say "6/8 방화벽 80/443 열기"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport "$p" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi

stop_status
say "7/8 HTTPS 주소 설정"
if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
  DOMAIN="${IP//./-}.sslip.io"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:3001
}
CADDY
systemctl reload caddy || systemctl restart caddy
echo "https://$DOMAIN" > /root/mungle-url.txt

say "8/8 자동 업데이트 (GitHub main → 5분 안에 반영)"
cat > /etc/systemd/system/mungle-update.service <<UNIT
[Unit]
Description=Mungle Village auto update (GitHub main)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$ENVFILE
ExecStart=/bin/bash $APP/deploy/autoupdate.sh
UNIT
cat > /etc/systemd/system/mungle-update.timer <<UNIT
[Unit]
Description=Check GitHub main for Mungle Village updates every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now mungle-update.timer >/dev/null

for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  say "완료! 1~2분 뒤 접속해 보세요 → https://$DOMAIN"
  echo "   (주소가 안 열리면 오라클 콘솔에서 80·443 포트 수신 규칙을 추가했는지 확인)"
else
  echo "서버가 아직 안 켜졌어요. 로그 확인: sudo journalctl -u mungle -n 50"
  exit 1
fi

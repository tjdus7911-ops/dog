#!/usr/bin/env bash
# 멍글마을 서버 설치 스크립트 (Ubuntu 22.04 / 24.04, ARM·x86 모두 가능 — 오라클 클라우드 무료 VM 기준)
#
# 사용법 (서버에 SSH로 접속한 뒤 한 줄 실행):
#   curl -fsSL https://raw.githubusercontent.com/tjdus7911-ops/dog/main/deploy/setup.sh | sudo bash -s -- "" "운영자 이름" "연락 이메일"
#   - 첫 번째 값: 도메인 (비워 두면 서버 IP로 무료 주소 <IP>.sslip.io 를 자동으로 사용)
#   - 두 번째·세 번째 값: 이용약관/개인정보 처리방침에 표시할 운영자 이름과 연락처
#   - 네 번째 값(선택): 운영자(관리 화면) 아이디, 쉼표로 여러 개
#
# 하는 일: Node.js 22·Caddy 설치 → 코드 내려받기·빌드 → 서비스 등록(자동 재시작) → HTTPS 자동 발급 → 방화벽 80/443 열기
# 다시 실행해도 안전합니다. 데이터(/var/lib/mungle)와 설정(/etc/mungle.env)은 덮어쓰지 않습니다.
set -euo pipefail

DOMAIN="${1:-}"
OPERATOR="${2:-}"
CONTACT="${3:-}"
ADMINS="${4:-}"
REPO="${MUNGLE_REPO:-https://github.com/tjdus7911-ops/dog.git}"
APP=/opt/mungle
DATA=/var/lib/mungle
ENVFILE=/etc/mungle.env
export DEBIAN_FRONTEND=noninteractive

[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행해 주세요."; exit 1; }
say() { printf '\n\033[1;35m🐾 %s\033[0m\n' "$*"; }

say "1/7 기본 패키지 설치"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https

# 메모리가 작은 VM(1GB)에서도 빌드가 되도록 스왑 2GB 확보
if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 2000 ] && ! swapon --show | grep -q .; then
  say "메모리가 작아 스왑 2GB를 만듭니다"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "2/7 Node.js 22 설치"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

say "3/7 Caddy(HTTPS 웹서버) 설치"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

say "4/7 코드 내려받기·빌드"
id mungle >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/mungle --shell /usr/sbin/nologin mungle
mkdir -p "$DATA" && chown mungle:mungle "$DATA"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone "$REPO" "$APP"; fi
chown -R mungle:mungle "$APP"
sudo -u mungle -H bash -c "cd '$APP' && npm ci --include=dev --no-audit --no-fund && npm run build"

say "5/7 서비스 등록"
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

say "6/7 방화벽 80/443 열기"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport "$p" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi

say "7/7 HTTPS 주소 설정"
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

for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  say "완료! 1~2분 뒤 접속해 보세요 → https://$DOMAIN"
  echo "   (주소가 안 열리면 오라클 콘솔에서 80·443 포트 수신 규칙을 추가했는지 확인)"
else
  echo "서버가 아직 안 켜졌어요. 로그 확인: sudo journalctl -u mungle -n 50"
  exit 1
fi

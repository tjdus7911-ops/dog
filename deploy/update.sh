#!/usr/bin/env bash
# 멍글마을 업데이트: GitHub 최신 코드로 바꾸고 다시 시작 (데이터는 그대로)
#   sudo bash /opt/mungle/deploy/update.sh
set -euo pipefail
APP=/opt/mungle
[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행해 주세요."; exit 1; }
sudo -u mungle -H bash -c "cd '$APP' && git pull --ff-only && npm ci --include=dev --no-audit --no-fund && npm run build"
systemctl restart mungle
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3001/api/health >/dev/null && echo "🐾 업데이트 완료" || { echo "실행 실패: sudo journalctl -u mungle -n 50"; exit 1; }

#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# 오라클 클라우드 인스턴스 생성 화면의 "초기화 스크립트(cloud-init)" 칸에 통째로 붙여 넣으면
# 서버가 처음 켜질 때 멍글마을을 자동으로 설치합니다. (SSH 접속 필요 없음, 10~15분)
# 따옴표 안의 값만 바꿔 주세요.
# ─────────────────────────────────────────────────────────────────────────────
OPERATOR="멍글마을 운영자"   # 이용약관·개인정보 처리방침에 표시할 운영자 이름
CONTACT="연락 이메일"        # 위 문서에 표시할 연락처
ADMINS="운영자아이디"        # 관리 화면을 쓸 내 아이디 (새 서버에서 이 아이디로 가입하면 운영자)
DOMAIN=""                    # 내 도메인이 있으면 예: "mungle.kr" (비워 두면 https://서버IP.sslip.io)

# (선택) 서버 밖 백업 — 비공개 GitHub 저장소에 DB·강아지 사진 자동 저장. 안 쓰면 비워 두기
# Render 에서 이 저장소를 쓰고 있었다면 같은 값을 넣으면 그 데이터를 그대로 가져옵니다.
export MUNGLE_GITHUB_REPO=""   # 예: "tjdus7911-ops/mungle-data"
export MUNGLE_GITHUB_TOKEN=""  # 그 저장소 하나만 쓸 수 있는 토큰 (github_pat_...)

# 설치할 브랜치 (이전 작업 중에는 oracle-move — 작업이 끝나면 자동으로 main 을 따라감)
export MUNGLE_BRANCH="oracle-move"

curl -fsSL "https://raw.githubusercontent.com/tjdus7911-ops/dog/$MUNGLE_BRANCH/deploy/setup.sh" -o /root/mungle-setup.sh
bash /root/mungle-setup.sh "$DOMAIN" "$OPERATOR" "$CONTACT" "$ADMINS" > /var/log/mungle-setup.log 2>&1

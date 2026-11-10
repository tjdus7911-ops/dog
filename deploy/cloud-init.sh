#!/bin/bash
# 오라클 클라우드 인스턴스 생성 화면의 "cloud-init 스크립트" 칸에 붙여 넣으면
# 서버가 처음 켜질 때 멍글마을을 자동으로 설치합니다. (SSH 접속 불필요)
# 아래 세 값을 바꿔서 사용하세요.
OPERATOR="멍글마을 운영자"
CONTACT="연락 이메일"
ADMINS="운영자아이디"
curl -fsSL https://raw.githubusercontent.com/tjdus7911-ops/dog/main/deploy/setup.sh -o /root/mungle-setup.sh
bash /root/mungle-setup.sh "" "$OPERATOR" "$CONTACT" "$ADMINS" > /var/log/mungle-setup.log 2>&1

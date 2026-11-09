# 멍글마을 무료 서버 운영 가이드 (오라클 클라우드 Always Free)

지인 수십 명이 24시간 쓸 수 있는 서버를 **월 0원**으로 운영하는 방법입니다.
오라클 클라우드의 "Always Free" 가상 서버 1대에 멍글마을을 설치합니다.

| 항목 | 내용 |
|---|---|
| 비용 | 무료 한도 안에서 0원 (Ampere A1: 2 OCPU · 메모리 12GB까지, 디스크 200GB) |
| 위치 | 홈 리전을 **한국 중부(서울)** 로 고르면 국내에서 빠릅니다. (춘천 리전은 A1 무료 서버 생성 불가) |
| 주소 | 도메인이 없어도 `https://<서버IP>.sslip.io` 형태의 무료 HTTPS 주소가 자동으로 생깁니다 |
| 데이터 | 서버 디스크에 영구 저장, 하루 1번 자동 백업(최근 7개 보관) |

> ⚠️ 알아 둘 점
> - 가입할 때 본인 확인용으로 카드 등록이 필요합니다(무료 한도 안에서는 청구되지 않음).
> - 무료 계정의 서버는 7일 동안 CPU·네트워크·메모리 사용률이 모두 20% 미만이면 "유휴 서버"로 회수될 수 있습니다. 지인 테스트 규모에서는 해당될 수 있으니, 아래 백업을 주기적으로 받아 두세요.
> - 인기 리전은 무료 서버 자리가 부족해 "Out of host capacity" 오류가 날 수 있습니다. 잠시 뒤 다시 시도하거나 다른 가용 도메인을 고르세요.

---

## 1. 오라클 클라우드 가입
1. https://www.oracle.com/kr/cloud/free/ 에서 **무료로 시작하기**
2. 홈 리전: **South Korea Central (Seoul)** 선택 (나중에 바꿀 수 없음)

## 2. 서버(인스턴스) 만들기
1. 콘솔 메뉴 → **컴퓨트 → 인스턴스 → 인스턴스 생성**
2. 이미지: **Canonical Ubuntu 24.04** (또는 22.04)
3. 구성(Shape): **Ampere → VM.Standard.A1.Flex**, OCPU 1~2 / 메모리 6~12GB
   - A1이 자리가 없으면 **VM.Standard.E2.1.Micro**(메모리 1GB)도 됩니다. 설치 스크립트가 스왑을 자동으로 만들어 줍니다.
4. 네트워킹: 기본값(새 VCN, 공용 IP 할당)
5. SSH 키: **개인 키 저장**을 눌러 키 파일을 꼭 내려받아 두세요
6. 생성 후 화면에 보이는 **공용 IP 주소**를 메모

## 3. 80·443 포트 열기 (콘솔)
1. 인스턴스 화면 → **서브넷** 클릭 → **보안 목록(Default Security List)**
2. **수신 규칙 추가** 2번
   - 소스 CIDR `0.0.0.0/0`, IP 프로토콜 TCP, 대상 포트 `80`
   - 소스 CIDR `0.0.0.0/0`, IP 프로토콜 TCP, 대상 포트 `443`

## 4. 서버에 접속해서 설치 (명령어 한 줄)
Windows는 **PowerShell**, Mac은 **터미널**에서:
```
ssh -i 내려받은키파일경로 ubuntu@공용IP
```
접속되면 아래 한 줄을 붙여 넣으세요. 따옴표 안의 운영자 이름·연락처는 약관에 표시됩니다.
```
curl -fsSL https://raw.githubusercontent.com/tjdus7911-ops/dog/main/deploy/setup.sh | sudo bash -s -- "" "운영자 이름" "연락 이메일"
```
5~10분 뒤 `완료! → https://xxx-xxx-xxx-xxx.sslip.io` 가 나오면 그 주소를 친구들에게 보내면 됩니다.
(자기 도메인이 있으면 첫 번째 `""` 자리에 `"mungle.kr"`처럼 넣고, 도메인의 A 레코드를 서버 IP로 지정하세요.)

## 5. 운영 명령어
| 하고 싶은 일 | 명령어 |
|---|---|
| 최신 코드로 업데이트 | `sudo bash /opt/mungle/deploy/update.sh` |
| 서버 상태 보기 | `sudo systemctl status mungle` |
| 최근 로그 보기 | `sudo journalctl -u mungle -n 100` |
| 다시 시작 | `sudo systemctl restart mungle` |
| 설정 바꾸기 (운영자 아이디, 정원, AI 키 등) | `sudo nano /etc/mungle.env` 후 다시 시작 |

- **운영자(관리 화면) 지정**: `/etc/mungle.env` 의 `MUNGLE_ADMINS=` 에 내 아이디를 적고 다시 시작 → **처음 가입하는 그 아이디**가 운영자가 됩니다. (이미 가입한 아이디는 적용되지 않으니 운영자 아이디는 설정 후 가입하세요.)

## 6. 백업
- 서버가 하루 1번 `/var/lib/mungle/backups/` 에 DB 백업을 만들고 최근 7개를 남깁니다.
- 서버가 통째로 사라지는 경우를 대비해, 가끔 내 PC로 내려받아 두세요:
```
scp -i 키파일 -r ubuntu@공용IP:/var/lib/mungle/backups ./mungle-backups
```
- 강아지 사진은 `/var/lib/mungle/uploads/` 에 있습니다(같은 방법으로 내려받기).

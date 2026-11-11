# 멍글마을 서버 운영 가이드 (오라클 클라우드 Always Free)

오라클 클라우드의 무료 가상 서버 1대에 멍글마을을 설치합니다. 서버를 만들 때 스크립트 하나만 붙여 넣으면
SSH 접속 없이 알아서 설치되고, 이후에는 GitHub `main` 에 올라온 새 코드가 5분 안에 자동으로 반영됩니다.

| 항목 | 내용 |
|---|---|
| 비용 | 무료 한도 안에서 0원 (Ampere A1: 2 OCPU · 메모리 12GB까지, 디스크 200GB, 나가는 데이터 월 10TB) |
| 위치 | 홈 리전 **South Korea Central (Seoul)** — 춘천 리전은 A1 무료 서버를 만들 수 없음 |
| 주소 | 도메인이 없어도 `https://<서버IP의 점을 -로>.sslip.io` 무료 HTTPS 주소가 자동으로 생김 |
| 데이터 | 서버 디스크에 영구 저장 + 하루 1번 서버 안 백업(최근 7개) + (선택) 비공개 GitHub 저장소에 서버 밖 백업 |
| 업데이트 | `main` 에 올리면 5분 안에 자동 반영. 빌드가 실패하거나 새 버전이 안 켜지면 이전 버전 그대로 |

> ⚠️ 알아 둘 점
> - **종량제(Pay As You Go)로 업그레이드 권장**: 무료 한도 안에서는 청구되지 않고, 무료 전용 계정에 있는
>   "7일 동안 사용률이 모두 20% 미만이면 유휴 서버 회수" 위험과 서버 자리 부족을 줄여 줍니다.
>   업그레이드할 때 **예산 알림(예: 1달러)** 을 꼭 걸어 두세요.
> - 무료 한도는 오라클이 예고 없이 바꿀 수 있습니다(2026년 6월 4코어·24GB → 2코어·12GB). 서버 밖 백업을 켜 두면 안심.
> - "Out of host capacity" 오류: 서울 리전에 무료 서버 자리가 없다는 뜻. 다른 가용 도메인(AD)을 고르거나 잠시 뒤 다시.

---

## 0. (Render 데이터를 옮기는 경우만) Render 먼저 멈추기
Render 에서 비공개 GitHub 데이터 저장소(`MUNGLE_GITHUB_REPO`)를 쓰고 있었다면, 오라클 서버를 만들기 **전에**
Render 대시보드 → 서비스 → **Settings → Suspend Web Service**. 멈출 때 마지막 데이터가 저장소에 저장되고,
새 오라클 서버가 처음 켜질 때 그 데이터를 그대로 가져옵니다. (두 서버가 같은 저장소에 동시에 쓰지 않게 하려는 것)

## 1. 오라클 클라우드 가입
1. https://www.oracle.com/kr/cloud/free/ → **무료로 시작하기**
2. 홈 리전: **South Korea Central (Seoul)** (나중에 바꿀 수 없음)
3. (권장) 가입 후 콘솔 → **결제 → 업그레이드 및 계정 관리 → 종량제로 업그레이드**, 그리고 **예산 → 예산 만들기**(1달러, 알림 이메일)

## 2. 서버(인스턴스) 만들기 — 설치 스크립트 붙여 넣기
1. 콘솔 메뉴 → **컴퓨트 → 인스턴스 → 인스턴스 생성**
2. 이미지: **Canonical Ubuntu 24.04**
3. 구성(Shape): **Ampere → VM.Standard.A1.Flex**, OCPU **2** / 메모리 **12GB**
   - A1 자리가 없으면 **VM.Standard.E2.1.Micro**(메모리 1GB)도 됩니다 (스왑을 자동으로 만들어 줌).
4. 네트워킹: 기본값 (새 VCN, **공용 IPv4 주소 할당**)
5. SSH 키: **개인 키 저장**으로 키 파일을 내려받아 보관 (문제가 생겼을 때 접속용)
6. 아래쪽 **고급 옵션 표시 → 관리 → 초기화 스크립트 → cloud-init 스크립트 붙여넣기** 에
   [`cloud-init.sh`](cloud-init.sh) 내용을 통째로 붙여 넣고, 따옴표 안 값(운영자 이름·연락처·내 아이디, 선택: 백업 저장소)을 바꾸기
7. **생성** → 화면의 **공용 IP 주소** 메모

## 3. 80·443 포트 열기 (콘솔)
1. 인스턴스 화면 → **서브넷** → **보안 목록(Default Security List)**
2. **수신 규칙 추가** 2번: 소스 CIDR `0.0.0.0/0`, TCP, 대상 포트 `80` / 같은 방법으로 `443`

## 4. 접속 확인
10~15분 뒤 `https://공용IP의-점을-대시로.sslip.io` (예: `152.70.1.2` → `https://152-70-1-2.sslip.io`)
- 운영자: cloud-init 에 적은 아이디로 **새로 가입**하면 관리 화면이 열립니다(이미 있는 아이디는 그대로).

## 5. 예전 Render 주소 → 새 주소로 안내
Render 대시보드 → 서비스 → **Environment** 에서
- `MUNGLE_MOVED_TO` = `https://새주소` 추가 (끝에 / 없이)
- 0번에서 멈췄다면 **Resume** 으로 다시 켜기
이렇게 하면 예전 링크로 들어온 사람은 새 주소로 자동으로 넘어가고, 예전 서버는 데이터를 저장하지 않습니다.

---

## 운영 명령어 (SSH: `ssh -i 키파일 ubuntu@공용IP`)
| 하고 싶은 일 | 명령어 |
|---|---|
| 지금 바로 업데이트 | `sudo bash /opt/mungle/deploy/update.sh` |
| 자동 업데이트 기록 | `sudo journalctl -u mungle-update -n 50` |
| 서버 상태 / 로그 | `sudo systemctl status mungle` / `sudo journalctl -u mungle -n 100` |
| 다시 시작 | `sudo systemctl restart mungle` |
| 설치 기록 (처음 설치 문제 확인) | `sudo tail -n 80 /var/log/mungle-setup.log` |
| 설정 바꾸기 (운영자 아이디, 정원, AI 키 등) | `sudo nano /etc/mungle.env` 후 다시 시작 |
| 내 주소 확인 | `sudo cat /root/mungle-url.txt` |

SSH 프로그램이 없으면 오라클 콘솔 오른쪽 위 **Cloud Shell** 에서 같은 명령으로 접속할 수 있습니다.

## 백업
- 서버 안: 하루 1번 `/var/lib/mungle/backups/` (최근 7개). 사진은 `/var/lib/mungle/uploads/`.
- 서버 밖(선택, 권장): cloud-init 의 `MUNGLE_GITHUB_REPO`·`MUNGLE_GITHUB_TOKEN` (저장소·토큰 만드는 법은 [RENDER.md](RENDER.md) 1~2번).
  평소엔 5분마다 백업만 하고, 서버 DB가 없을 때(새 서버로 옮길 때)만 저장소에서 되살립니다.
- 직접 내려받기: `scp -i 키파일 -r ubuntu@공용IP:/var/lib/mungle/backups ./mungle-backups`

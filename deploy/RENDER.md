# 카드 없이 무료로 운영하기 (Render + GitHub 데이터 저장소)

카드 등록 없이 GitHub 계정만으로 멍글마을을 공개 주소에 띄우는 방법입니다.

| 항목 | 내용 |
|---|---|
| 비용 | 0원, 카드 등록 없음 |
| 데이터 | 가입 정보·친구·대화·강아지 사진을 **내 비공개 GitHub 저장소**에 자동 저장 (5분마다 + 서버가 잠들기 직전) → 재시작해도 유지 |
| 단점 | 15분 동안 아무도 접속하지 않으면 서버가 잠들어요. 다시 접속할 때 첫 화면까지 30초~1분 걸려요. 서버가 갑자기 꺼지면 마지막 몇 분 사이의 변경이 빠질 수 있어요 |

## 1. 데이터 저장용 비공개 저장소 만들기
1. https://github.com/new
2. Repository name: `mungle-data`, **Private** 선택 → **Create repository**

## 2. 그 저장소만 쓸 수 있는 토큰 만들기
1. https://github.com/settings/personal-access-tokens/new
2. Token name: `mungle-render`, Expiration: 원하는 기간 (예: 1년)
3. Repository access: **Only select repositories** → `mungle-data`
4. Permissions → Repository permissions → **Contents: Read and write**
5. **Generate token** → 나온 토큰(`github_pat_...`)을 복사해 두기 (다시 볼 수 없음)

## 3. Render에 배포
1. https://render.com → **GitHub로 로그인** (카드 필요 없음)
2. **New → Blueprint** → 저장소 `tjdus7911-ops/dog` 선택
3. 입력 칸에 값 넣기
   - `MUNGLE_GITHUB_REPO`: `tjdus7911-ops/mungle-data`
   - `MUNGLE_GITHUB_TOKEN`: 2번에서 복사한 토큰
   - `MUNGLE_OPERATOR`: 약관에 표시할 운영자 이름
   - `MUNGLE_CONTACT`: 연락 이메일
   - `MUNGLE_ADMINS`: 운영자(관리 화면)로 쓸 아이디 (이 아이디로 **새로 가입**하면 운영자가 됨)
   - `ANTHROPIC_API_KEY`: 비워 두기 (AI 사진 분석만 꺼짐)
4. **Apply** → 5~10분 뒤 `https://mungle-village-xxxx.onrender.com` 주소가 생기면 친구들에게 공유

## 확인
- `mungle-data` 저장소에 `mungle.db` 파일과 `uploads/` 폴더가 생기면 저장이 잘 되고 있는 거예요 (첫 가입 후 5분 이내 또는 서버가 잠들 때).
- 토큰이 틀리면 서버가 데이터를 덮어쓰지 않도록 **아예 시작하지 않아요**. Render의 Logs 화면에 "GitHub 데이터 복원 실패"가 보이면 토큰과 저장소 이름을 확인하세요.

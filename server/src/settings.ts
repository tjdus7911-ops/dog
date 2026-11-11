// 운영 설정 (코드에 고정하지 않고 바꿀 수 있는 정책 값)
// - 서버 DB(app_settings)에 저장된 값이 우선, 없으면 환경변수 기본값
// - 관리자 화면(/api/admin/settings)에서 바꿀 수 있음. 바꿔도 기존 사용자 데이터·이용 권한은 그대로
import { db, one, run } from './db';

db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 무료 이사 요청 번호 (같은 요청이 두 번 와도 한 번만 처리)
CREATE TABLE IF NOT EXISTS move_requests (
  user_id INTEGER NOT NULL,
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ref)
);
`);

export interface AppSettings {
  /** 아파트(원룸·투룸·쓰리룸) 무료 이용 — 입주·이사 코인 차감 없음, 순서·횟수 제한 없음 (기본: 꺼짐 = 유료 입주) */
  apartmentFreeAccess: boolean;
}

const envBool = (v: string | undefined, dflt: boolean) => (v === undefined || v === '' ? dflt : !/^(0|false|no|off)$/i.test(v));
const DEFAULTS: AppSettings = {
  apartmentFreeAccess: envBool(process.env.MUNGLE_APARTMENT_FREE, false),
};

export function getSettings(): AppSettings {
  const row = one("SELECT value FROM app_settings WHERE key='apartmentFreeAccess'");
  return { apartmentFreeAccess: row ? row.value === '1' : DEFAULTS.apartmentFreeAccess };
}
export const apartmentFree = () => getSettings().apartmentFreeAccess;

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  if (typeof patch.apartmentFreeAccess === 'boolean') {
    run(`INSERT INTO app_settings (key, value, updated_at) VALUES ('apartmentFreeAccess', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`, patch.apartmentFreeAccess ? '1' : '0', Date.now());
  }
  return getSettings();
}

// 이용 정지 공통 규칙 (로그인·API·실시간 연결이 같은 안내를 씀)
/** 영구 정지 = 아주 먼 미래까지 */
export const PERMANENT_BAN = 32503680000000; // 3000-01-01
/** 정지된 회원에게 보여 줄 안내 (사유·기간·문의처) */
export function banMessage(until: number, reason: string) {
  const contact = process.env.MUNGLE_CONTACT?.trim();
  const period = until >= PERMANENT_BAN ? '영구 정지' : `${new Date(until).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지`;
  // 문의처: 서버 설정(MUNGLE_CONTACT)이 있으면 그 주소, 없으면 이용약관의 문의 항목 안내
  return `이용이 정지된 계정이에요.\n기간: ${period}\n사유: ${reason || '운영 정책 위반'}\n문의: ${contact || "멍글마을 운영팀 (이용약관의 '문의' 항목)"}`;
}

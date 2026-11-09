// 이용약관 · 개인정보 처리방침
// 운영자 이름과 연락처는 서버 환경변수(MUNGLE_OPERATOR, MUNGLE_CONTACT)에서 /api/site 로 받아 표시한다.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { DEMO } from '../demo';
import { Modal } from './common';

export type LegalDoc = 'terms' | 'privacy';
type Site = { operator: string; contact: string; aiAnalysis: boolean };

const EFFECTIVE = '2026년 11월 9일';

function useSite() {
  const [site, setSite] = useState<Site | null>(null);
  useEffect(() => {
    if (DEMO) { setSite({ operator: '', contact: '', aiAnalysis: false }); return; }
    api<Site>('/api/site', { token: null }).then(setSite).catch(() => setSite({ operator: '', contact: '', aiAnalysis: false }));
  }, []);
  return site;
}

const H = ({ children }: { children: ReactNode }) => <h3 className="font-display text-base mt-4 mb-1">{children}</h3>;
const Ul = ({ children }: { children: ReactNode }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>;

function Terms({ op, contact }: { op: string; contact: string }) {
  return (
    <>
      <H>제1조 (목적)</H>
      <p>이 약관은 {op}(이하 "운영자")가 제공하는 3D 반려견 산책 커뮤니티 "멍글마을"(이하 "서비스")의 이용 조건과 절차, 운영자와 회원의 권리·의무를 정합니다.</p>
      <H>제2조 (회원가입)</H>
      <Ul>
        <li>만 14세 이상인 분만 가입할 수 있습니다.</li>
        <li>이 약관과 개인정보 처리방침에 동의하면 가입이 완료됩니다.</li>
        <li>다른 사람의 정보를 도용하거나 사칭해서는 안 됩니다.</li>
      </Ul>
      <H>제3조 (회원의 의무)</H>
      <p>회원은 다음 행위를 해서는 안 됩니다.</p>
      <Ul>
        <li>욕설·비하·혐오 표현, 성적인 내용, 다른 회원을 괴롭히는 행위</li>
        <li>같은 내용을 반복해서 올리는 도배, 광고·스팸</li>
        <li>다른 사람의 개인정보(연락처, 주소 등)를 올리거나 요구하는 행위</li>
        <li>타인의 권리를 침해하는 사진을 올리는 행위</li>
        <li>서비스를 비정상적으로 이용하거나 운영을 방해하는 행위</li>
      </Ul>
      <H>제4조 (운영 조치)</H>
      <p>운영자는 신고를 검토해 위 의무를 어긴 회원의 게시물을 숨기거나, 일정 기간 또는 영구적으로 이용을 정지할 수 있습니다. 공원 채팅에는 자동 금칙어 필터와 도배 방지가 적용됩니다.</p>
      <H>제5조 (게시물)</H>
      <p>회원이 올린 닉네임, 강아지 정보·사진, 채팅의 권리는 회원에게 있습니다. 운영자는 서비스 화면에 표시하는 범위에서만 이를 이용합니다.</p>
      <H>제6조 (서비스의 제공과 변경)</H>
      <Ul>
        <li>서비스는 무료로 제공되며, 현재 시범 운영 단계입니다.</li>
        <li>점검이나 서버 사정으로 서비스가 중단되거나 내용이 바뀔 수 있으며, 중요한 변경은 미리 알립니다.</li>
        <li>운영자는 데이터를 정기적으로 백업하지만, 시범 운영 중 예기치 못한 장애로 일부 기록이 사라질 수 있습니다.</li>
      </Ul>
      <H>제7조 (탈퇴)</H>
      <p>회원은 언제든 "개인정보·차단 설정" 화면에서 탈퇴할 수 있습니다. 탈퇴하면 계정 정보는 즉시 삭제되며 되돌릴 수 없습니다.</p>
      <H>제8조 (책임의 제한)</H>
      <p>운영자는 회원끼리 서비스 밖에서 만나거나 주고받은 일에 대해서는 책임지지 않습니다. 서비스 안에서 낯선 사람에게 개인정보를 알려 주지 않도록 주의해 주세요.</p>
      <H>문의</H>
      <p>{contact}</p>
      <p className="mt-4 text-cocoa-soft">시행일: {EFFECTIVE}</p>
    </>
  );
}

function Privacy({ op, contact, ai }: { op: string; contact: string; ai: boolean }) {
  return (
    <>
      <p>{op}(이하 "운영자")는 「개인정보 보호법」에 따라 회원의 개인정보를 다음과 같이 처리합니다.</p>
      <H>1. 수집하는 항목과 목적</H>
      <Ul>
        <li><b>가입·로그인</b>: 아이디, 비밀번호(복원할 수 없게 암호화해 저장) — 회원 식별과 로그인</li>
        <li><b>프로필</b>: 닉네임, 강아지 이름·소개, 아바타 꾸미기 설정, 강아지 사진(선택) — 다른 회원에게 내 아바타와 강아지를 보여 주기 위해</li>
        <li><b>커뮤니티</b>: 친구·친구 신청·차단 목록, 1:1 대화 내용, 공개 범위 설정 — 친구와 대화 기능 제공</li>
        <li><b>안전한 운영</b>: 신고 내용과 신고 대상의 최근 공원 채팅(최대 10개), 이용 정지 기록 — 신고 처리와 재발 방지</li>
        <li><b>자동 수집</b>: 접속 IP(가입·로그인 횟수 제한에만 사용하며 따로 저장하지 않음)</li>
      </Ul>
      <p className="mt-1">공원 채팅은 따로 저장하지 않고, 서버 메모리에 공원별 최근 100개만 잠시 머물렀다가 사라집니다(신고된 경우 위 범위만 신고 기록에 남습니다).</p>
      <H>2. 보유 기간</H>
      <Ul>
        <li>회원 탈퇴 시 계정, 프로필, 사진, 친구·차단 목록, 1:1 대화, 신고 기록을 즉시 삭제합니다.</li>
        <li>장애 대비용 백업본에는 최대 7일 동안 남아 있다가 자동으로 삭제됩니다.</li>
      </Ul>
      <H>3. 제3자 제공 · 국외 이전</H>
      <p>운영자는 회원의 개인정보를 제3자에게 제공하지 않습니다.</p>
      {ai ? (
        <p className="mt-1">단, 회원이 "AI 강아지 사진 분석"을 직접 실행한 경우에 한해, 올린 강아지 사진을 분석하려고 Anthropic, PBC(미국)의 AI 서비스로 전송합니다. 사진은 분석 결과를 받는 데에만 쓰이며 운영자 서버에 저장되지 않습니다. 이 기능을 쓰지 않으면 전송되지 않습니다.</p>
      ) : (
        <p className="mt-1">AI 강아지 사진 분석 기능이 켜질 경우, 회원이 직접 실행할 때만 사진을 분석 서비스로 보내며 이 방침에 그 내용을 먼저 안내합니다.</p>
      )}
      <H>4. 브라우저 저장</H>
      <p>로그인 상태를 유지하기 위해 로그인 토큰을 브라우저 저장소(localStorage)에 저장합니다. 로그아웃하면 삭제되며, 14일이 지나면 만료됩니다. 광고·추적용 쿠키는 쓰지 않습니다.</p>
      <H>5. 회원의 권리</H>
      <p>회원은 언제든 내 정보를 보고 고칠 수 있고(아바타 꾸미기·설정 화면), 탈퇴로 삭제를 요청할 수 있습니다. 그 밖의 요청은 아래 연락처로 보내 주세요.</p>
      <H>6. 안전성 확보 조치</H>
      <p>비밀번호 암호화 저장, 암호화 통신(HTTPS), 가입·로그인 횟수 제한, 운영자 권한 분리를 적용합니다.</p>
      <H>7. 만 14세 미만</H>
      <p>만 14세 미만은 가입할 수 없습니다. 만 14세 미만의 가입 사실을 알게 되면 해당 계정을 삭제합니다.</p>
      <H>8. 개인정보 보호책임자</H>
      <p>{op} · {contact}</p>
      <p className="mt-4 text-cocoa-soft">시행일: {EFFECTIVE}</p>
    </>
  );
}

export function LegalModal({ doc, onClose }: { doc: LegalDoc; onClose: () => void }) {
  const [tab, setTab] = useState<LegalDoc>(doc);
  const site = useSite();
  const op = site?.operator || '멍글마을 운영자';
  const contact = site?.contact ? `연락처: ${site.contact}` : '연락처: 서비스 안 공지 참고';
  return (
    <Modal onClose={onClose} className="max-w-[560px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="grid grid-cols-2 gap-1 bg-cream-2 rounded-full p-1 flex-1">
          {(['terms', 'privacy'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`btn py-1.5 text-sm ${tab === t ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`}>
              {t === 'terms' ? '이용약관' : '개인정보 처리방침'}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost w-9 h-9" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="text-sm leading-relaxed text-cocoa">
        {!site ? <p className="text-cocoa-soft">불러오는 중…</p>
          : tab === 'terms' ? <Terms op={op} contact={contact} /> : <Privacy op={op} contact={contact} ai={site.aiAnalysis} />}
      </div>
    </Modal>
  );
}

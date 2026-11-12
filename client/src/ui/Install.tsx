// 홈 화면에 추가 — 버튼과 기기별 안내 시트
import { useEffect, useState, type ReactNode } from 'react';
import { canOfferInstall, closeInstallGuide, device, externalOpenUrl, inApp, IN_APP_NAME, mobile, openInAppGuide, startInstall, usePwa } from '../pwa';
import { toast } from '../store';
import { LogoMark } from './Logo';
import { Icon } from './icons';
import { backdropClose } from './common';

/** 설치 버튼을 누른 뒤 결과 알림 */
export async function installFromButton() {
  const r = await startInstall();
  if (r === 'accepted') toast('홈 화면에 멍글마을을 추가했어요', 'info');
}

/** 로그인 화면 아래: 링크로 들어온 사람에게 보이는 설치 카드 */
export function InstallCard() {
  const pwa = usePwa();
  if (!canOfferInstall(pwa)) return null;
  return (
    <button type="button" onClick={() => void installFromButton()} data-testid="install-card"
      className="mt-3 w-full flex items-center gap-3 rounded-[20px] bg-white/80 border border-[#EAE3DC] px-4 py-3 text-left active:bg-[#F7F1EA]">
      <span className="shrink-0 w-11 h-11 rounded-[12px] bg-[#EF8466] grid place-items-center"><LogoMark size={34} onTile /></span>
      <span className="flex-1 min-w-0">
        <span className="block font-display text-[15px] text-[#51473F]">홈 화면에 멍글마을 추가</span>
        <span className="block text-[12px] text-[#8A8078]">앱처럼 아이콘을 눌러 바로 열 수 있어요</span>
      </span>
      <span className="text-[#756B63]"><Icon name="download" size={20} /></span>
    </button>
  );
}

// ---------------------------------------------------------------- 게임 화면 상단의 '홈 화면에 추가' 칩 (모바일)
// 처음 온 사람도 찾기 쉽게 장소 선택 옆에 작게 띄움. 이미 홈 화면 앱으로 열었거나 설치했으면 안 보임.
// ✕로 닫으면 14일 동안 숨김 (더보기 → 설정 → '홈 화면에 추가'는 언제든 그대로). 닫아도 게임에는 영향 없음.
const HINT_KEY = 'mungle.installHint';
const HINT_DAYS = 14;
function hintHidden() {
  try { const until = Number(localStorage.getItem(HINT_KEY) ?? 0); return until > Date.now(); } catch { return false; }
}
export function InstallChip() {
  const pwa = usePwa();
  const [hidden, setHidden] = useState(hintHidden);
  if (hidden || !(mobile || inApp) || !canOfferInstall(pwa)) return null;
  const dismiss = () => {
    try { localStorage.setItem(HINT_KEY, String(Date.now() + HINT_DAYS * 86400_000)); } catch { /* 저장 불가: 이번 접속 동안만 숨김 */ }
    setHidden(true);
  };
  return (
    <div className="hud rounded-full h-9 flex items-center shrink-0 pointer-events-auto ml-2 pl-1 pr-0.5" data-testid="install-chip">
      <button type="button" className="h-9 flex items-center gap-1 pl-1.5 pr-1 text-[13px] whitespace-nowrap" onClick={() => void installFromButton()} aria-label="홈 화면에 멍글마을 추가">
        <Icon name="download" size={16} className="text-[#E58D76] shrink-0" />홈 화면에 추가
      </button>
      <button type="button" className="w-7 h-9 grid place-items-center text-[#8A8078]" onClick={dismiss} aria-label="홈 화면 추가 안내 닫기" data-testid="install-chip-close">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

const Step = ({ n, children }: { n: number; children: ReactNode }) => (
  <li className="flex gap-3 items-start">
    <span className="shrink-0 w-6 h-6 rounded-full bg-[#FBE3DA] text-[#C9624A] text-[13px] grid place-items-center font-display">{n}</span>
    <span className="text-[14px] leading-relaxed pt-0.5">{children}</span>
  </li>
);
const Chip = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 align-middle rounded-md border border-[#EAE3DC] bg-white px-1.5 py-0.5 text-[13px] text-[#51473F]">{children}</span>
);

async function copyLink() {
  const url = location.origin + '/';
  try { await navigator.clipboard.writeText(url); toast('주소를 복사했어요. 브라우저 주소창에 붙여 넣어 주세요', 'info'); }
  catch { window.prompt('아래 주소를 복사해 브라우저에서 열어 주세요', url); }
}

/** 기기별 설치 안내 (앱 전체에서 하나) */
export function InstallGuideSheet() {
  const { guide } = usePwa();
  useEffect(() => {
    if (!guide) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeInstallGuide(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guide]);
  if (!guide) return null;
  const ext = guide === 'inapp' ? externalOpenUrl() : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-[#51473F40]" {...backdropClose(closeInstallGuide)}>
      <section role="dialog" aria-label="홈 화면에 추가하는 방법" data-testid="install-guide"
        className="w-full sm:max-w-[400px] bg-[#FFFCF8] text-[#51473F] rounded-t-[22px] sm:rounded-[22px] border border-[#EAE3DC] px-5 pt-4 max-h-[85dvh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: 'calc(var(--safe-b) + 18px)' }}>
        <div className="flex items-center gap-3">
          <span className="shrink-0 w-12 h-12 rounded-[13px] bg-[#EF8466] grid place-items-center"><LogoMark size={36} onTile /></span>
          <h2 className="flex-1 font-display text-[18px] leading-tight">
            {guide === 'inapp' ? '기본 브라우저에서 열어 주세요' : '홈 화면에 멍글마을 추가'}
          </h2>
          <button className="w-11 h-11 -mr-2 rounded-full grid place-items-center text-[#756B63]" onClick={closeInstallGuide} aria-label="닫기"><Icon name="x" size={20} /></button>
        </div>

        {guide === 'ios' && (
          <ol className="mt-4 space-y-3">
            <Step n={1}>{device.iosOther ? '주소창 오른쪽' : '화면 아래쪽(아이패드는 위쪽)'}의 <Chip><Icon name="share" size={15} />공유</Chip> 버튼을 눌러요.</Step>
            <Step n={2}>목록에서 <Chip><Icon name="plusSquare" size={15} />홈 화면에 추가</Chip>를 골라요. 안 보이면 목록을 아래로 내려 보세요.</Step>
            <Step n={3}>오른쪽 위 <b>추가</b>를 누르면 홈 화면에 멍글마을 아이콘이 생겨요.</Step>
          </ol>
        )}
        {guide === 'android' && (
          <ol className="mt-4 space-y-3">
            <Step n={1}>{device.samsung ? <>화면 아래쪽 메뉴 <Chip>≡</Chip>를 눌러요.</> : <>오른쪽 위 메뉴 <Chip><Icon name="moreVert" size={15} /></Chip>를 눌러요.</>}</Step>
            <Step n={2}>{device.samsung ? <><b>현재 페이지 추가</b> → <b>홈 화면</b>을 골라요.</> : <><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 골라요.</>}</Step>
            <Step n={3}><b>설치</b>(또는 <b>추가</b>)를 누르면 홈 화면에 아이콘이 생겨요.</Step>
          </ol>
        )}
        {guide === 'desktop' && (
          <ol className="mt-4 space-y-3">
            <Step n={1}>크롬·엣지: 주소창 오른쪽의 설치 아이콘을 누르거나, 메뉴 <Chip><Icon name="moreVert" size={15} /></Chip>에서 <b>멍글마을 설치</b>(엣지는 <b>앱</b> → <b>이 사이트를 앱으로 설치</b>)를 골라요.</Step>
            <Step n={2}>맥 사파리: 위쪽 메뉴의 <b>파일</b> → <b>Dock에 추가</b>를 골라요.</Step>
            <Step n={3}>설치 메뉴가 없는 브라우저(파이어폭스 등)는 크롬이나 엣지로 열어 주세요.</Step>
          </ol>
        )}
        {guide === 'inapp' && inApp && (
          <>
            <p className="mt-3 text-[14px] leading-relaxed">{IN_APP_NAME[inApp]} 안에서 열린 화면에서는 3D 화면이 느리거나 홈 화면에 추가할 수 없어요. {device.ios ? '사파리' : '크롬'} 같은 기본 브라우저로 열어 주세요.</p>
            {device.ios && (
              <ol className="mt-3 space-y-3">
                <Step n={1}>화면 오른쪽 위나 아래의 <Chip>···</Chip> 또는 <Chip><Icon name="share" size={15} /></Chip> 버튼을 눌러요.</Step>
                <Step n={2}><b>Safari로 열기</b>(또는 <b>외부 브라우저로 열기</b>)를 골라요.</Step>
              </ol>
            )}
            <div className="grid gap-2 mt-4">
              {ext && <a href={ext} className="btn btn-peach py-3 text-[15px] flex items-center justify-center gap-2" data-testid="open-external"><Icon name="external" size={18} />{device.ios ? '사파리로 열기' : '기본 브라우저로 열기'}</a>}
              <button type="button" className="btn btn-ghost py-3 text-[15px] border border-[#EAE3DC] flex items-center justify-center gap-2" onClick={() => void copyLink()}><Icon name="copy" size={18} />주소 복사하기</button>
            </div>
          </>
        )}
        {guide !== 'inapp' && (
          <p className="mt-4 text-[12px] text-[#8A8078]">
            홈 화면 아이콘으로 열면 주소창 없이 앱처럼 넓게 보여요.{guide === 'ios' && ' 아이폰은 홈 화면 앱에서 처음 한 번 다시 로그인해야 할 수 있어요.'}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * 인스타그램·카카오톡 등 앱 속 브라우저에서 열렸을 때 위쪽 안내 띠.
 * (페이지가 열리자마자 기본 브라우저로 한 번 자동으로 넘기고 — index.html — 그래도 여기 남아 있으면 보여 줌)
 */
export function InAppBanner() {
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('mungle.inappHide') === '1'; } catch { return false; } });
  if (!inApp || hidden) return null;
  const ext = externalOpenUrl();
  const close = () => { try { sessionStorage.setItem('mungle.inappHide', '1'); } catch { /* 이번 화면에서만 숨김 */ } setHidden(true); };
  return (
    <div className="fixed inset-x-0 z-[65] flex justify-center px-3 pointer-events-none" style={{ top: 'calc(var(--safe-t, 0px) + 8px)' }} data-testid="inapp-banner">
      <div className="panel pointer-events-auto w-full max-w-[460px] !rounded-[18px] px-3 py-2.5 flex items-center gap-2">
        <Icon name="external" size={18} className="text-[#E58D76] shrink-0" />
        <p className="flex-1 min-w-0 text-[13px] leading-snug">{IN_APP_NAME[inApp]} 안에서 열렸어요. {device.ios ? '사파리' : '크롬'}에서 열면 더 매끄러워요.</p>
        {ext
          ? <a href={ext} className="btn btn-peach px-3 py-1.5 text-[13px] shrink-0" data-testid="inapp-open">열기</a>
          : <button type="button" className="btn btn-peach px-3 py-1.5 text-[13px] shrink-0" onClick={openInAppGuide}>방법</button>}
        {ext && <button type="button" className="text-[12px] underline text-[#8A8078] shrink-0" onClick={openInAppGuide}>방법</button>}
        <button type="button" className="w-7 h-7 grid place-items-center text-[#8A8078] shrink-0" onClick={close} aria-label="안내 닫기"><Icon name="x" size={14} /></button>
      </div>
    </div>
  );
}

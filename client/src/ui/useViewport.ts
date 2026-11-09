// 실제로 보이는 화면(Visual Viewport) 기준 크기 — 모바일 키보드가 올라오면 가려지는 높이를 계산한다.
import { useEffect, useState } from 'react';

export interface ViewportInfo {
  /** 레이아웃 전체 높이 (window.innerHeight) */
  fullHeight: number;
  /** 지금 보이는 영역의 높이 (키보드가 열리면 줄어듦) */
  visibleHeight: number;
  /** 화면 아래에서 가려진 높이 (≈ 키보드 높이) */
  bottomInset: number;
  keyboardOpen: boolean;
}

function read(): ViewportInfo {
  const full = window.innerHeight;
  const vv = window.visualViewport;
  if (!vv) return { fullHeight: full, visibleHeight: full, bottomInset: 0, keyboardOpen: false };
  const inset = Math.max(0, Math.round(full - vv.height - vv.offsetTop));
  // 주소창 접힘 등 작은 변화는 키보드로 보지 않음
  return { fullHeight: full, visibleHeight: vv.height, bottomInset: inset, keyboardOpen: inset > 120 };
}

export function useVisualViewport() {
  const [info, setInfo] = useState<ViewportInfo>(read);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setInfo(read());
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return info;
}

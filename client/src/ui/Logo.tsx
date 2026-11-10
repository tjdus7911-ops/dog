// 멍글마을 로고 심볼: 머리 윗부분이 굴뚝 달린 집 지붕이고, 처마에서 귀가 늘어진 강아지 (강아지 + 마을)
// 원본 도형은 public/logo.svg 와 같음. 아주 작게 쓸 때(24px 이하)는 simple 로 눈·코만 남김.
// onTile: 코랄 바탕(앱 아이콘 모양) 위에 올릴 때 — 지붕을 크림색으로
const COL = { cocoa: '#5A4033', roof: '#EF8466', ear: '#C98257', face: '#F7CB9C', muzzle: '#FFF5EA', blush: '#F29A86' };

export function LogoMark({ size = 32, simple = size <= 24, onTile = false, className }: { size?: number; simple?: boolean; onTile?: boolean; className?: string }) {
  const h = Math.round((size * 320) / 352);
  const roof = onTile ? '#FFF6EC' : COL.roof;
  return (
    <svg width={size} height={h} viewBox="80 100 352 320" className={className} role="img" aria-label="멍글마을 로고">
      <path d="M164 228 C112 236 90 300 98 352 C103 388 142 394 158 364 C172 336 176 300 186 266 Z" fill={COL.ear} />
      <path d="M348 228 C400 236 422 300 414 352 C409 388 370 394 354 364 C340 336 336 300 326 266 Z" fill={COL.ear} />
      <path d="M160 226 H352 V318 A96 90 0 0 1 160 318 Z" fill={COL.face} />
      {!simple && <ellipse cx="256" cy="356" rx="58" ry="44" fill={COL.muzzle} />}
      <rect x="314" y="146" width="30" height="62" rx="6" fill={roof} />
      <path d="M256 140 L138 238 H374 Z" fill={roof} stroke={roof} strokeWidth="40" strokeLinejoin="round" />
      <circle cx="212" cy="306" r={simple ? 18 : 15} fill={COL.cocoa} />
      <circle cx="300" cy="306" r={simple ? 18 : 15} fill={COL.cocoa} />
      {simple ? <ellipse cx="256" cy="346" rx="21" ry="15" fill={COL.cocoa} /> : (
        <>
          <circle cx="217" cy="301" r="5" fill="#fff" /><circle cx="305" cy="301" r="5" fill="#fff" />
          <ellipse cx="256" cy="340" rx="18" ry="13" fill={COL.cocoa} />
          <path d="M236 360 q10 12 20 0 q10 12 20 0" fill="none" stroke={COL.cocoa} strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="184" cy="344" rx="16" ry="10" fill={COL.blush} opacity=".55" />
          <ellipse cx="328" cy="344" rx="16" ry="10" fill={COL.blush} opacity=".55" />
        </>
      )}
    </svg>
  );
}

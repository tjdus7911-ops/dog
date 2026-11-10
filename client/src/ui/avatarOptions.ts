// 아바타 편집 화면용 라벨 · 프리셋 (썸네일로 보여 줄 스타일+색 조합)
import { DEFAULT_HUMAN, type BottomStyle, type HumanAvatar, type ShoeStyle, type TopStyle } from '@shared/avatar';

export const LABEL: Record<string, string> = {
  bob: '단발', bun: '똥머리', twin: '양갈래', long: '긴 생머리', short: '숏컷', pony: '포니테일', spiky: '삐죽머리',
  hoodie: '후드티', tee: '티셔츠', stripe: '줄무늬 티', overalls: '멜빵', jacket: '재킷',
  shorts: '반바지', pants: '긴바지', skirt: '치마',
  sneaker: '운동화', boots: '부츠',
  none: '없음', cap: '캡모자', bucket: '버킷햇', beanie: '비니', headphones: '헤드폰',
  glasses: '동그란 안경', square_glasses: '네모 안경', backpack: '백팩', crossbag: '크로스백',
  small: '소형', medium: '중형', large: '대형',
  patch: '얼룩', saddle: '등 무늬', mask: '얼굴·가슴 흰털', socks: '흰 양말',
  floppy: '늘어진 귀', pointy: '쫑긋 선 귀', fold: '반쯤 접힌 귀',
  curl: '말린 꼬리', straight: '곧은 꼬리', fluffy: '풍성한 꼬리',
};
export const SNOUT_LABEL: Record<string, string> = { short: '짧은 주둥이', medium: '보통 주둥이', long: '긴 주둥이' };
export const FUR_LABEL: Record<string, string> = { short: '단모', long: '장모' };
export const MARKING_LABEL: Record<string, string> = { none: '없음', blaze: '이마 흰 줄', eyepatch: '한쪽 눈 얼룩', darkmask: '검은 주둥이·눈가' };
export const EAR_SIZE_LABEL: Record<string, string> = { small: '작은 귀', medium: '보통 귀', large: '큰 귀' };
export const BUILD_LABEL: Record<string, string> = { slim: '날씬', normal: '보통', chubby: '통통' };
export const BODY_LEN_LABEL: Record<string, string> = { short: '짧은 몸', normal: '보통 몸', long: '긴 몸' };
export const LEG_LEN_LABEL: Record<string, string> = { short: '짧은 다리', normal: '보통 다리', long: '긴 다리' };
export const TAIL_LABEL: Record<string, string> = { ...LABEL, short: '짧은 꼬리' };

export const TOP_PRESETS: { top: TopStyle; topColor: string }[] = [
  { top: 'hoodie', topColor: '#f3e3c3' },
  { top: 'stripe', topColor: '#ffffff' },
  { top: 'hoodie', topColor: '#7ea6d8' },
  { top: 'hoodie', topColor: '#f6c453' },
  { top: 'hoodie', topColor: '#f4a6b8' },
  { top: 'overalls', topColor: '#5b7fb8' },
  { top: 'jacket', topColor: '#9c7656' },
  { top: 'tee', topColor: '#8fb88a' },
  { top: 'hoodie', topColor: '#c9b6e8' },
];

export const BOTTOM_PRESETS: { bottom: BottomStyle; bottomColor: string }[] = [
  { bottom: 'shorts', bottomColor: '#5b7fb8' },
  { bottom: 'shorts', bottomColor: '#f3e3c3' },
  { bottom: 'shorts', bottomColor: '#3a3a44' },
  { bottom: 'shorts', bottomColor: '#f4a6b8' },
  { bottom: 'skirt', bottomColor: '#5b7fb8' },
  { bottom: 'pants', bottomColor: '#c9a27a' },
  { bottom: 'pants', bottomColor: '#4a5a78' },
];

export const SHOE_PRESETS: { shoes: ShoeStyle; shoeColor: string }[] = [
  { shoes: 'sneaker', shoeColor: '#ffffff' },
  { shoes: 'sneaker', shoeColor: '#f4a6b8' },
  { shoes: 'sneaker', shoeColor: '#3a3a44' },
  { shoes: 'sneaker', shoeColor: '#f6c453' },
  { shoes: 'sneaker', shoeColor: '#7ea6d8' },
  { shoes: 'boots', shoeColor: '#8a5a3a' },
];

/** 아바타 예시 (클릭하면 그대로 적용) */
export const EXAMPLES: HumanAvatar[] = [
  { ...DEFAULT_HUMAN, skin: '#f6cfa8', hairStyle: 'short', hairColor: '#3b2a20', top: 'hoodie', topColor: '#ffffff', bottom: 'shorts', bottomColor: '#4a5a78', shoeColor: '#ffffff', hat: 'cap', hatColor: '#5b7fb8', accessory: 'none' },
  { ...DEFAULT_HUMAN, skin: '#f8d5bc', hairStyle: 'twin', hairColor: '#6b4127', top: 'overalls', topColor: '#f4a6b8', bottom: 'skirt', bottomColor: '#f4a6b8', shoeColor: '#f4a6b8', hat: 'bucket', hatColor: '#f3e3c3', accessory: 'none' },
  { ...DEFAULT_HUMAN, skin: '#e5b48a', hairStyle: 'short', hairColor: '#1f1f24', top: 'jacket', topColor: '#9c7656', bottom: 'pants', bottomColor: '#3a3a44', shoeColor: '#3a3a44', hat: 'beanie', hatColor: '#4a5a78', accessory: 'glasses' },
  { ...DEFAULT_HUMAN, skin: '#f8d5bc', hairStyle: 'long', hairColor: '#6b4127', top: 'hoodie', topColor: '#c9b6e8', bottom: 'shorts', bottomColor: '#f3e3c3', shoeColor: '#ffffff', hat: 'headphones', hatColor: '#c9b6e8', accessory: 'none' },
];

/** 썸네일용 기준 아바타: 썸네일마다 관련 항목만 바꿔 불필요한 재렌더를 줄인다 */
export const THUMB_BASE: HumanAvatar = {
  ...DEFAULT_HUMAN, hat: 'none', accessory: 'none', top: 'tee', topColor: '#fff3df', bottom: 'shorts', bottomColor: '#fff3df', shoes: 'sneaker', shoeColor: '#ffffff',
};

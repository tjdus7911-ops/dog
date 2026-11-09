// 사람·강아지 아바타 설정 정의 (클라이언트 렌더링과 서버 검증이 함께 사용)
// 3D 모델을 GLB로 교체하더라도 이 설정 구조는 그대로 유지하도록 설계했다.

export const SKIN_TONES = ['#ffe0c7', '#f6cfa8', '#e5b48a', '#c98f62', '#9a6643'] as const;
export const HAIR_COLORS = ['#3b2a20', '#6b4127', '#a8693a', '#e2b866', '#1f1f24', '#d88a7a'] as const;
export const CLOTH_COLORS = [
  '#fff3df', '#f6c453', '#f39a7b', '#8fb88a', '#7ea6d8', '#b59ad6', '#f4a6b8', '#4a5a78', '#c9a27a', '#ffffff',
] as const;
export const SHOE_COLORS = ['#ffffff', '#4a3b33', '#f39a7b', '#4a5a78', '#e9d9bd'] as const;

export const HAIR_STYLES = ['short', 'bob', 'long', 'bun', 'spiky'] as const;
export const TOP_STYLES = ['hoodie', 'tee', 'jacket'] as const;
export const BOTTOM_STYLES = ['shorts', 'pants', 'skirt'] as const;
export const HAT_STYLES = ['none', 'cap', 'beanie'] as const;
export const ACCESSORIES = ['none', 'backpack', 'glasses'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type TopStyle = (typeof TOP_STYLES)[number];
export type BottomStyle = (typeof BOTTOM_STYLES)[number];
export type HatStyle = (typeof HAT_STYLES)[number];
export type Accessory = (typeof ACCESSORIES)[number];

export interface HumanAvatar {
  skin: string;
  hairStyle: HairStyle;
  hairColor: string;
  top: TopStyle;
  topColor: string;
  bottom: BottomStyle;
  bottomColor: string;
  shoeColor: string;
  hat: HatStyle;
  hatColor: string;
  accessory: Accessory;
}

export const COAT_COLORS = [
  '#f7f1e6', '#f2dcb8', '#e6b47a', '#d98c4a', '#b8703a', '#7a4a2c', '#3a302c', '#9a9aa2', '#e8e4dc',
] as const;
export const HARNESS_COLORS = ['#e8574a', '#f39a7b', '#5b8fd1', '#7cb36b', '#f6c453', '#b59ad6'] as const;

export const DOG_SIZES = ['small', 'medium', 'large'] as const;
export const DOG_PATTERNS = ['none', 'patch', 'saddle', 'mask', 'socks'] as const;
export const DOG_EARS = ['floppy', 'pointy', 'fold'] as const;
export const DOG_TAILS = ['curl', 'straight', 'fluffy', 'short'] as const;
export const DOG_FUR = ['short', 'long'] as const;
export const DOG_SNOUTS = ['short', 'medium', 'long'] as const;

export type DogSize = (typeof DOG_SIZES)[number];
export type DogPattern = (typeof DOG_PATTERNS)[number];
export type DogEar = (typeof DOG_EARS)[number];
export type DogTail = (typeof DOG_TAILS)[number];
export type DogFur = (typeof DOG_FUR)[number];
export type DogSnout = (typeof DOG_SNOUTS)[number];

/** 미리 정의된 파츠 조합. AI 분석 결과도 이 구조로만 출력되어 파츠 조합 방식을 유지한다. */
export interface DogAvatar {
  breed: string;
  size: DogSize;
  coat: string;
  secondary: string;
  pattern: DogPattern;
  ear: DogEar;
  tail: DogTail;
  fur: DogFur;
  snout: DogSnout;
  harness: string;
}

export const DEFAULT_HUMAN: HumanAvatar = {
  skin: SKIN_TONES[0],
  hairStyle: 'bob',
  hairColor: HAIR_COLORS[1],
  top: 'hoodie',
  topColor: CLOTH_COLORS[0],
  bottom: 'shorts',
  bottomColor: CLOTH_COLORS[4],
  shoeColor: SHOE_COLORS[0],
  hat: 'cap',
  hatColor: CLOTH_COLORS[0],
  accessory: 'backpack',
};

/** 견종 프리셋 — 수동 커스터마이징의 출발점. (AI 분석은 아직 연결되지 않음) */
export const BREED_PRESETS: Record<string, { label: string; dog: Omit<DogAvatar, 'harness'> }> = {
  shiba: { label: '시바/진도형', dog: { breed: 'shiba', size: 'medium', coat: '#d98c4a', secondary: '#f7f1e6', pattern: 'mask', ear: 'pointy', tail: 'curl', fur: 'short', snout: 'medium' } },
  maltese: { label: '말티즈형', dog: { breed: 'maltese', size: 'small', coat: '#f7f1e6', secondary: '#f7f1e6', pattern: 'none', ear: 'floppy', tail: 'fluffy', fur: 'long', snout: 'short' } },
  poodle: { label: '푸들형', dog: { breed: 'poodle', size: 'small', coat: '#b8703a', secondary: '#b8703a', pattern: 'none', ear: 'floppy', tail: 'fluffy', fur: 'long', snout: 'medium' } },
  husky: { label: '허스키형', dog: { breed: 'husky', size: 'large', coat: '#9a9aa2', secondary: '#f7f1e6', pattern: 'mask', ear: 'pointy', tail: 'fluffy', fur: 'short', snout: 'long' } },
  retriever: { label: '리트리버형', dog: { breed: 'retriever', size: 'large', coat: '#e6b47a', secondary: '#e6b47a', pattern: 'none', ear: 'floppy', tail: 'straight', fur: 'short', snout: 'long' } },
  beagle: { label: '비글형', dog: { breed: 'beagle', size: 'medium', coat: '#f7f1e6', secondary: '#b8703a', pattern: 'saddle', ear: 'floppy', tail: 'straight', fur: 'short', snout: 'medium' } },
  corgi: { label: '웰시코기형', dog: { breed: 'corgi', size: 'small', coat: '#d98c4a', secondary: '#f7f1e6', pattern: 'socks', ear: 'pointy', tail: 'short', fur: 'short', snout: 'medium' } },
  mix: { label: '믹스/기타', dog: { breed: 'mix', size: 'medium', coat: '#7a4a2c', secondary: '#f7f1e6', pattern: 'patch', ear: 'fold', tail: 'straight', fur: 'short', snout: 'medium' } },
};

export const DEFAULT_DOG: DogAvatar = { ...BREED_PRESETS.shiba.dog, harness: HARNESS_COLORS[0] };

const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/** 서버·클라이언트 공용 검증. 허용 목록 밖의 값은 거부한다. */
export function validateHuman(v: any): HumanAvatar | null {
  if (!v || typeof v !== 'object') return null;
  const ok =
    oneOf(SKIN_TONES, v.skin) && oneOf(HAIR_STYLES, v.hairStyle) && oneOf(HAIR_COLORS, v.hairColor) &&
    oneOf(TOP_STYLES, v.top) && oneOf(CLOTH_COLORS, v.topColor) && oneOf(BOTTOM_STYLES, v.bottom) &&
    oneOf(CLOTH_COLORS, v.bottomColor) && oneOf(SHOE_COLORS, v.shoeColor) && oneOf(HAT_STYLES, v.hat) &&
    oneOf(CLOTH_COLORS, v.hatColor) && oneOf(ACCESSORIES, v.accessory);
  if (!ok) return null;
  return {
    skin: v.skin, hairStyle: v.hairStyle, hairColor: v.hairColor, top: v.top, topColor: v.topColor,
    bottom: v.bottom, bottomColor: v.bottomColor, shoeColor: v.shoeColor, hat: v.hat, hatColor: v.hatColor,
    accessory: v.accessory,
  };
}

export function validateDog(v: any): DogAvatar | null {
  if (!v || typeof v !== 'object') return null;
  const ok =
    typeof v.breed === 'string' && v.breed in BREED_PRESETS && oneOf(DOG_SIZES, v.size) &&
    oneOf(COAT_COLORS, v.coat) && oneOf(COAT_COLORS, v.secondary) && oneOf(DOG_PATTERNS, v.pattern) &&
    oneOf(DOG_EARS, v.ear) && oneOf(DOG_TAILS, v.tail) && oneOf(DOG_FUR, v.fur) &&
    oneOf(DOG_SNOUTS, v.snout) && oneOf(HARNESS_COLORS, v.harness);
  if (!ok) return null;
  return {
    breed: v.breed, size: v.size, coat: v.coat, secondary: v.secondary, pattern: v.pattern, ear: v.ear,
    tail: v.tail, fur: v.fur, snout: v.snout, harness: v.harness,
  };
}

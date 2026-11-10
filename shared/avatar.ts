// 사람·강아지 아바타 설정 정의 (클라이언트 렌더링과 서버 검증이 함께 사용)
// 3D 모델을 GLB로 교체하더라도 이 설정 구조는 그대로 유지하도록 설계했다.

/** 피부색 (v5: 생기 있는 살구빛 계열) — 기본 · 밝은 · 베이지 · 태닝 · 어두운 */
export const SKIN_TONES = ['#f8d5bc', '#ffe2ce', '#ebc09f', '#c98e69', '#936448'] as const;
/** 이전 피부색 → 새 피부색 (저장된 아바타는 그대로 두고 읽을 때 같은 순서의 새 색으로 바꿔 보여줌) */
const SKIN_UPGRADE: Record<string, string> = { '#ffe0c7': '#f8d5bc', '#f6cfa8': '#ffe2ce', '#e5b48a': '#ebc09f', '#c98f62': '#c98e69', '#9a6643': '#936448' };
export const HAIR_COLORS = ['#3b2a20', '#6b4127', '#a8693a', '#e2b866', '#e9965a', '#1f1f24', '#d88a7a', '#f4a3b5', '#c4a8e8'] as const;
export const CLOTH_COLORS = [
  '#fff3df', '#f6c453', '#f39a7b', '#8fb88a', '#7ea6d8', '#b59ad6', '#f4a6b8', '#4a5a78', '#c9a27a', '#ffffff',
  '#5b7fb8', '#3a3a44', '#f3e3c3', '#9c7656', '#c9b6e8',
] as const;
export const SHOE_COLORS = ['#ffffff', '#4a3b33', '#f39a7b', '#4a5a78', '#e9d9bd', '#f4a6b8', '#f6c453', '#7ea6d8', '#8a5a3a', '#3a3a44'] as const;

export const HAIR_STYLES = ['bob', 'bun', 'twin', 'long', 'short', 'pony', 'spiky'] as const;
export const TOP_STYLES = ['hoodie', 'tee', 'stripe', 'overalls', 'jacket'] as const;
export const BOTTOM_STYLES = ['shorts', 'pants', 'skirt'] as const;
export const HAT_STYLES = ['none', 'cap', 'bucket', 'beanie', 'headphones'] as const;
export const SHOE_STYLES = ['sneaker', 'boots'] as const;
export const ACCESSORIES = ['none', 'glasses', 'square_glasses', 'backpack', 'crossbag'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type TopStyle = (typeof TOP_STYLES)[number];
export type BottomStyle = (typeof BOTTOM_STYLES)[number];
export type HatStyle = (typeof HAT_STYLES)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type ShoeStyle = (typeof SHOE_STYLES)[number];

export interface HumanAvatar {
  skin: string;
  hairStyle: HairStyle;
  hairColor: string;
  top: TopStyle;
  topColor: string;
  bottom: BottomStyle;
  bottomColor: string;
  shoeColor: string;
  /** v2 추가 항목 — 이전 데이터에는 없을 수 있어 normalize 시 기본값 적용 */
  shoes: ShoeStyle;
  hat: HatStyle;
  hatColor: string;
  accessory: Accessory;
}

/** 털색 팔레트 (v5: 더 밝고 화사하게, 채도는 과하지 않게) */
export const COAT_COLORS = [
  '#fff8ee', '#f6e2bf', '#f1c77c', '#e9a05c', '#dda778', '#8a5a3a', '#3e3531', '#aab8c5', '#efebe4',
  '#efae58', '#fff2de',
] as const;
/** 이전 기본 털색 → 새 털색 (사진에서 뽑은 임의의 색은 바꾸지 않음) */
const COAT_UPGRADE: Record<string, string> = {
  '#f7f1e6': '#fff8ee', '#f2dcb8': '#f6e2bf', '#e6b47a': '#f1c77c', '#d98c4a': '#e9a05c', '#b8703a': '#dda778',
  '#7a4a2c': '#8a5a3a', '#3a302c': '#3e3531', '#9a9aa2': '#aab8c5', '#e8e4dc': '#efebe4', '#eea54e': '#efae58', '#fbefd9': '#fff2de',
};
export const upgradeCoat = (c: string) => COAT_UPGRADE[c] ?? c;
export const HARNESS_COLORS = ['#e8574a', '#f39a7b', '#5b8fd1', '#7cb36b', '#f6c453', '#b59ad6'] as const;

export const DOG_SIZES = ['small', 'medium', 'large'] as const;
export const DOG_PATTERNS = ['none', 'patch', 'saddle', 'mask', 'socks'] as const;
export const DOG_EARS = ['floppy', 'pointy', 'fold'] as const;
export const DOG_TAILS = ['curl', 'straight', 'fluffy', 'short'] as const;
export const DOG_FUR = ['short', 'long'] as const;
export const DOG_SNOUTS = ['short', 'medium', 'long'] as const;
/** v3 세부 특징 (사진 분석으로 더 닮게) — 이전 데이터에는 없을 수 있어 기본값으로 채움 */
export const DOG_MARKINGS = ['none', 'blaze', 'eyepatch', 'darkmask'] as const;
export const DOG_EAR_SIZES = ['small', 'medium', 'large'] as const;
export const DOG_BUILDS = ['slim', 'normal', 'chubby'] as const;
export const DOG_LENGTHS = ['short', 'normal', 'long'] as const;

export type DogSize = (typeof DOG_SIZES)[number];
export type DogPattern = (typeof DOG_PATTERNS)[number];
export type DogEar = (typeof DOG_EARS)[number];
export type DogTail = (typeof DOG_TAILS)[number];
export type DogFur = (typeof DOG_FUR)[number];
export type DogSnout = (typeof DOG_SNOUTS)[number];
export type DogMarking = (typeof DOG_MARKINGS)[number];
export type DogEarSize = (typeof DOG_EAR_SIZES)[number];
export type DogBuild = (typeof DOG_BUILDS)[number];
export type DogLength = (typeof DOG_LENGTHS)[number];

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
  /** 얼굴 무늬: blaze=이마~코 흰 줄, eyepatch=한쪽 눈 얼룩, darkmask=어두운 주둥이·눈가 */
  marking: DogMarking;
  earSize: DogEarSize;
  build: DogBuild;
  /** 몸통 길이 / 다리 길이 (short가 기본 SD 비율) */
  bodyLen: DogLength;
  legLen: DogLength;
  harness: string;
}

export type DogDetail = Pick<DogAvatar, 'marking' | 'earSize' | 'build' | 'bodyLen' | 'legLen'>;
export const DOG_DETAIL_DEFAULT: DogDetail = { marking: 'none', earSize: 'medium', build: 'normal', bodyLen: 'normal', legLen: 'short' };
type PresetDog = Omit<DogAvatar, 'harness' | keyof DogDetail> & Partial<DogDetail>;

export const DEFAULT_HUMAN: HumanAvatar = {
  skin: SKIN_TONES[0],
  hairStyle: 'bob',
  hairColor: HAIR_COLORS[1],
  top: 'hoodie',
  topColor: '#f3e3c3',
  bottom: 'shorts',
  bottomColor: '#5b7fb8',
  shoeColor: SHOE_COLORS[0],
  shoes: 'sneaker',
  hat: 'cap',
  hatColor: '#f3e3c3',
  accessory: 'none',
};

/** 견종 프리셋 — 수동 커스터마이징의 출발점. (AI 분석은 아직 연결되지 않음) */
const RAW_PRESETS: Record<string, { label: string; dog: PresetDog }> = {
  shiba: { label: '시바/진도형', dog: { breed: 'shiba', size: 'medium', coat: '#e9a05c', secondary: '#fff4e6', pattern: 'mask', ear: 'pointy', tail: 'curl', fur: 'short', snout: 'medium', legLen: 'normal' } },
  maltese: { label: '말티즈형', dog: { breed: 'maltese', size: 'small', coat: '#fff8ee', secondary: '#fff8ee', pattern: 'none', ear: 'floppy', tail: 'fluffy', fur: 'long', snout: 'short', earSize: 'small', build: 'chubby' } },
  poodle: { label: '푸들형', dog: { breed: 'poodle', size: 'small', coat: '#dda778', secondary: '#dda778', pattern: 'none', ear: 'floppy', tail: 'fluffy', fur: 'long', snout: 'medium' } },
  husky: { label: '허스키형', dog: { breed: 'husky', size: 'large', coat: '#aab8c5', secondary: '#fbfaf7', pattern: 'mask', ear: 'pointy', tail: 'fluffy', fur: 'short', snout: 'long', legLen: 'long', build: 'normal' } },
  retriever: { label: '리트리버형', dog: { breed: 'retriever', size: 'large', coat: '#f1c77c', secondary: '#f1c77c', pattern: 'none', ear: 'floppy', tail: 'straight', fur: 'short', snout: 'long', legLen: 'long', earSize: 'large', build: 'chubby' } },
  beagle: { label: '비글형', dog: { breed: 'beagle', size: 'medium', coat: '#fff8ee', secondary: '#d39a62', pattern: 'saddle', ear: 'floppy', tail: 'straight', fur: 'short', snout: 'medium', marking: 'blaze', legLen: 'normal', earSize: 'large' } },
  corgi: { label: '웰시코기형', dog: { breed: 'corgi', size: 'small', coat: '#efae58', secondary: '#fff2de', pattern: 'socks', ear: 'pointy', tail: 'short', fur: 'short', snout: 'medium', marking: 'blaze', earSize: 'large', bodyLen: 'long' } },
  pomeranian: { label: '포메라니안형', dog: { breed: 'pomeranian', size: 'small', coat: '#f1c27e', secondary: '#fff8ee', pattern: 'mask', ear: 'pointy', tail: 'fluffy', fur: 'long', snout: 'short', earSize: 'small', build: 'chubby' } },
  dachshund: { label: '닥스훈트형', dog: { breed: 'dachshund', size: 'small', coat: '#8a5a3a', secondary: '#e9a05c', pattern: 'mask', ear: 'floppy', tail: 'straight', fur: 'short', snout: 'long', bodyLen: 'long', earSize: 'large' } },
  mix: { label: '믹스/기타', dog: { breed: 'mix', size: 'medium', coat: '#8a5a3a', secondary: '#fff8ee', pattern: 'patch', ear: 'fold', tail: 'straight', fur: 'short', snout: 'medium' } },
};

export const BREED_PRESETS: Record<string, { label: string; dog: Omit<DogAvatar, 'harness'> }> = Object.fromEntries(
  Object.entries(RAW_PRESETS).map(([k, p]) => [k, { label: p.label, dog: { ...DOG_DETAIL_DEFAULT, ...p.dog } }]),
);

export const DEFAULT_DOG: DogAvatar = { ...BREED_PRESETS.shiba.dog, harness: HARNESS_COLORS[0] };

/** 털색: 기본 팔레트 또는 사진에서 뽑은 임의의 색(#rrggbb) */
export const isCoatColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v);

const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/** 서버·클라이언트 공용 검증. 허용 목록 밖의 값은 거부한다.
 *  새로 추가된 항목(shoes 등)이 빠진 이전 데이터는 기본값으로 채워 하위 호환을 유지한다. */
export function validateHuman(input: any): HumanAvatar | null {
  if (!input || typeof input !== 'object') return null;
  const v = { shoes: DEFAULT_HUMAN.shoes, ...input };
  if (typeof v.skin === 'string' && SKIN_UPGRADE[v.skin]) v.skin = SKIN_UPGRADE[v.skin];
  const ok =
    oneOf(SKIN_TONES, v.skin) && oneOf(HAIR_STYLES, v.hairStyle) && oneOf(HAIR_COLORS, v.hairColor) &&
    oneOf(TOP_STYLES, v.top) && oneOf(CLOTH_COLORS, v.topColor) && oneOf(BOTTOM_STYLES, v.bottom) &&
    oneOf(CLOTH_COLORS, v.bottomColor) && oneOf(SHOE_COLORS, v.shoeColor) && oneOf(SHOE_STYLES, v.shoes) &&
    oneOf(HAT_STYLES, v.hat) && oneOf(CLOTH_COLORS, v.hatColor) && oneOf(ACCESSORIES, v.accessory);
  if (!ok) return null;
  return {
    skin: v.skin, hairStyle: v.hairStyle, hairColor: v.hairColor, top: v.top, topColor: v.topColor,
    bottom: v.bottom, bottomColor: v.bottomColor, shoeColor: v.shoeColor, shoes: v.shoes, hat: v.hat, hatColor: v.hatColor,
    accessory: v.accessory,
  };
}

/** 저장된 데이터를 읽을 때 사용: 유효하지 않으면 기본 아바타로 대체 */
export const normalizeHuman = (v: unknown): HumanAvatar => validateHuman(v) ?? { ...DEFAULT_HUMAN };
export const normalizeDog = (v: unknown): DogAvatar => validateDog(v) ?? { ...DEFAULT_DOG };

export function validateDog(input: any): DogAvatar | null {
  if (!input || typeof input !== 'object') return null;
  const v = { ...DOG_DETAIL_DEFAULT, ...input };
  const ok =
    typeof v.breed === 'string' && v.breed in BREED_PRESETS && oneOf(DOG_SIZES, v.size) &&
    isCoatColor(v.coat) && isCoatColor(v.secondary) && oneOf(DOG_PATTERNS, v.pattern) &&
    oneOf(DOG_EARS, v.ear) && oneOf(DOG_TAILS, v.tail) && oneOf(DOG_FUR, v.fur) &&
    oneOf(DOG_SNOUTS, v.snout) && oneOf(HARNESS_COLORS, v.harness) &&
    oneOf(DOG_MARKINGS, v.marking) && oneOf(DOG_EAR_SIZES, v.earSize) && oneOf(DOG_BUILDS, v.build) &&
    oneOf(DOG_LENGTHS, v.bodyLen) && oneOf(DOG_LENGTHS, v.legLen);
  if (!ok) return null;
  return {
    breed: v.breed, size: v.size, coat: upgradeCoat(v.coat), secondary: upgradeCoat(v.secondary), pattern: v.pattern, ear: v.ear,
    tail: v.tail, fur: v.fur, snout: v.snout, harness: v.harness,
    marking: v.marking, earSize: v.earSize, build: v.build, bodyLen: v.bodyLen, legLen: v.legLen,
  };
}

/** 비회원 둘러보기 방문자 캐릭터 (회원 아바타와 구분되는 고정 모습: 세이지색 버킷햇 + 줄무늬 티) */
export const GUEST_HUMAN: HumanAvatar = { ...DEFAULT_HUMAN, hairStyle: 'short', top: 'stripe', topColor: CLOTH_COLORS[3], hat: 'bucket', hatColor: CLOTH_COLORS[3] };
export const GUEST_DOG: DogAvatar = { ...BREED_PRESETS.maltese.dog, harness: HARNESS_COLORS[3] };

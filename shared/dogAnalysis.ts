// AI 강아지 사진 분석 — 서버(Claude API)와 미리보기(Claude 앱 안 실행)가 함께 쓰는 질문·결과 해석
// AI는 새 3D 모델을 만들지 않고, 미리 만든 파츠 조합에 들어갈 값(견종 유형·귀·꼬리·털색 등)만 고른다.
import {
  BREED_PRESETS, COAT_COLORS, DOG_BUILDS, DOG_EAR_SIZES, DOG_LENGTHS, DOG_MARKINGS, DOG_EARS, DOG_FUR, DOG_PATTERNS, DOG_SIZES, DOG_SNOUTS, DOG_TAILS, HARNESS_COLORS,
  validateDog, type DogAvatar,
} from './avatar';

export type DogPhotoKind = 'front' | 'side' | 'full';
export const PHOTO_LABELS: Record<DogPhotoKind, string> = { front: '정면 사진', side: '측면 사진', full: '전신 사진' };

export interface DogFeatureResult {
  avatar: Omit<DogAvatar, 'harness'>;
  breedGuess: string;
  summary: string;
  confidence: number;
}

/** 털색 참고 팔레트 (AI가 실제 색을 고를 때 기준으로 삼도록) */
const COAT_NAMES: Record<string, string> = {
  '#f7f1e6': '흰색/아이보리', '#f2dcb8': '크림', '#e6b47a': '밝은 황금색/연갈색', '#d98c4a': '적황색(시바 레드)',
  '#eea54e': '코기 오렌지', '#b8703a': '갈색', '#7a4a2c': '진갈색/초콜릿', '#3a302c': '검정', '#9a9aa2': '회색/블루', '#e8e4dc': '은백색',
};

/** 응답 항목 정의 (서버는 도구 입력 스키마로, 미리보기는 JSON 형식 설명으로 사용) */
export const FEATURE_PROPERTIES = {
  is_dog: { type: 'boolean', description: '사진에 강아지가 분명하게 보이면 true' },
  breed: { type: 'string', enum: Object.keys(BREED_PRESETS), description: '가장 비슷한 견종 유형 (해당 없으면 mix)' },
  breed_guess_ko: { type: 'string', description: '추정 견종 이름(한국어, 짧게). 모르면 빈 문자열' },
  size: { type: 'string', enum: [...DOG_SIZES], description: 'small=소형, medium=중형, large=대형' },
  fur: { type: 'string', enum: [...DOG_FUR], description: 'short=단모, long=장모' },
  coat: { type: 'string', description: '가장 넓은 면적의 털색. 사진 속 실제 털색을 #rrggbb 16진수로 (그림자·조명 영향을 빼고 밝은 곳 기준)' },
  secondary: { type: 'string', description: '두 번째 털색(무늬 색, 보통 가슴·얼굴·발의 밝은 색)을 #rrggbb 로. 무늬가 없으면 coat와 같게' },
  pattern: { type: 'string', enum: [...DOG_PATTERNS], description: 'none=단색, patch=몸에 얼룩, saddle=등만 다른 색, mask=얼굴·가슴이 흰색/밝은색, socks=발만 흰색' },
  ear: { type: 'string', enum: [...DOG_EARS], description: 'floppy=늘어진 귀, pointy=쫑긋 선 귀, fold=반쯤 접힌 귀' },
  tail: { type: 'string', enum: [...DOG_TAILS], description: 'curl=등 위로 말린, straight=곧은, fluffy=풍성한, short=짧거나 거의 없음' },
  snout: { type: 'string', enum: [...DOG_SNOUTS], description: 'short=납작/짧은 주둥이, medium=보통, long=긴 주둥이' },
  marking: { type: 'string', enum: [...DOG_MARKINGS], description: '얼굴 무늬: none=없음, blaze=이마에서 코로 내려오는 흰 줄, eyepatch=한쪽 눈 주변 얼룩, darkmask=주둥이·눈가가 검은색(퍼그·셰퍼드 등)' },
  ear_size: { type: 'string', enum: [...DOG_EAR_SIZES], description: '머리 크기에 비한 귀 크기' },
  build: { type: 'string', enum: [...DOG_BUILDS], description: '몸매: slim=날씬, normal=보통, chubby=통통' },
  body_length: { type: 'string', enum: [...DOG_LENGTHS], description: '키에 비한 몸통 길이: short=짧고 동글, normal, long=허리가 긴(닥스훈트·코기)' },
  leg_length: { type: 'string', enum: [...DOG_LENGTHS], description: '몸에 비한 다리 길이: short=아주 짧음(코기·닥스훈트), normal=보통(소형견 대부분), long=긴 편(리트리버·허스키 등 중대형견)' },
  summary_ko: { type: 'string', description: '특징 요약 한 문장 (한국어, 40자 이내)' },
  confidence: { type: 'number', description: '0~1 사이 전체 판단 신뢰도' },
} as const;
export const FEATURE_REQUIRED = ['is_dog', 'breed', 'size', 'fur', 'coat', 'secondary', 'pattern', 'ear', 'tail', 'snout', 'marking', 'ear_size', 'build', 'body_length', 'leg_length', 'summary_ko', 'confidence'];

const GUIDE = `사진 속 반려견의 외형을 분석해 3D 아바타 파츠를 고르세요.
- 선택지가 있는 항목은 실제 강아지와 가장 비슷한 값을 고릅니다.
- 털색(coat, secondary)은 사진 속 실제 색을 #rrggbb 로 적습니다. 참고 색: ${Object.entries(COAT_NAMES).map(([k, v]) => `${k}=${v}`).join(', ')}
- 사진이 여러 장이면 같은 강아지로 보고 종합해서 판단하세요.
- 강아지가 보이지 않거나 판단이 불가능하면 is_dog=false 로 답하세요.`;

/** 서버(도구 호출 방식)용 질문 */
export const TOOL_PROMPT = `${GUIDE}\n- 반드시 report_dog_features 도구로만 답하세요.`;

/** 미리보기(JSON 응답 방식)용 질문 */
export function jsonPrompt(kinds: DogPhotoKind[]) {
  const fields = Object.entries(FEATURE_PROPERTIES).map(([k, v]) => {
    const e = 'enum' in v ? ` (다음 중 하나: ${v.enum.join(' | ')})` : '';
    return `- ${k}: ${v.type}${e} — ${v.description}`;
  }).join('\n');
  return `첨부한 사진 ${kinds.length}장은 같은 강아지의 ${kinds.map((k) => PHOTO_LABELS[k]).join(', ')}입니다 (첨부 순서대로).
${GUIDE}

아래 항목을 모두 담은 JSON 객체 하나만 답하세요. 다른 설명은 쓰지 마세요.
${fields}

예시: {"is_dog":true,"breed":"corgi","breed_guess_ko":"웰시코기","size":"small","fur":"short","coat":"#e9a352","secondary":"#fbefd9","pattern":"mask","ear":"pointy","tail":"short","snout":"medium","marking":"blaze","ear_size":"large","build":"normal","body_length":"long","leg_length":"short","summary_ko":"주황빛 털에 흰 가슴, 큰 쫑긋 귀","confidence":0.85}`;
}

const HEX = /^#[0-9a-f]{6}$/;
function toHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
  return HEX.test(s) ? s : null;
}

const oneOf = (list: readonly string[], v: unknown) => (typeof v === 'string' && list.includes(v) ? v : undefined);
function pickDetail(input: any) {
  const out: Record<string, string> = {};
  const set = (k: string, v: string | undefined) => { if (v) out[k] = v; };
  set('marking', oneOf(DOG_MARKINGS, input.marking));
  set('earSize', oneOf(DOG_EAR_SIZES, input.ear_size));
  set('build', oneOf(DOG_BUILDS, input.build));
  set('bodyLen', oneOf(DOG_LENGTHS, input.body_length));
  set('legLen', oneOf(DOG_LENGTHS, input.leg_length));
  return out;
}

export type InterpretResult = { ok: true; result: DogFeatureResult } | { ok: false; status: number; error: string };

/** AI 응답(도구 입력 또는 JSON)을 검증해 아바타 값으로 바꾼다 */
export function interpretDogFeatures(input: any): InterpretResult {
  if (!input || typeof input !== 'object') return { ok: false, status: 502, error: 'AI 분석 결과를 읽지 못했어요.' };
  if (input.is_dog === false) return { ok: false, status: 422, error: '사진에서 강아지를 찾지 못했어요. 강아지가 잘 보이는 사진으로 다시 시도해 주세요.' };
  const coat = toHex(input.coat) ?? COAT_COLORS[2];
  const secondary = input.pattern === 'none' ? coat : (toHex(input.secondary) ?? coat);
  const checked = validateDog({
    breed: input.breed, size: input.size, coat, secondary,
    pattern: input.pattern, ear: input.ear, tail: input.tail, fur: input.fur, snout: input.snout, harness: HARNESS_COLORS[0],
    // 세부 특징은 빠지거나 이상하면 기본값으로 (분석 실패로 처리하지 않음)
    ...pickDetail(input),
  });
  if (!checked) return { ok: false, status: 502, error: 'AI 분석 결과가 올바르지 않아요. 다시 시도해 주세요.' };
  const { harness: _h, ...avatar } = checked;
  return {
    ok: true,
    result: {
      avatar,
      breedGuess: typeof input.breed_guess_ko === 'string' ? input.breed_guess_ko.slice(0, 20) : '',
      summary: typeof input.summary_ko === 'string' ? input.summary_ko.slice(0, 80) : '',
      confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    },
  };
}

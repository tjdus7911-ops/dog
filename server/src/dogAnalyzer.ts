// AI 강아지 특징 분석 — Claude Vision API (Anthropic Messages API)
// 사진 1~3장(정면/측면/전신)을 보내고, 도구 호출(tool use) 형식으로 "미리 정의된 파츠 값"만 받도록 강제한다.
// → AI가 새 3D 모델을 만들지 않고, 기존 파츠 조합 렌더러에 그대로 들어가는 값만 돌려준다.
// 활성화: 서버 환경 변수 ANTHROPIC_API_KEY (선택: MUNGLE_AI_MODEL, MUNGLE_AI_BASE_URL)
import {
  BREED_PRESETS, COAT_COLORS, DOG_EARS, DOG_FUR, DOG_PATTERNS, DOG_SIZES, DOG_SNOUTS, DOG_TAILS, HARNESS_COLORS,
  validateDog, type DogAvatar,
} from '../../shared/avatar';

export interface DogPhoto { kind: 'front' | 'side' | 'full'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }

export interface DogFeatureResult {
  avatar: Omit<DogAvatar, 'harness'>;
  breedGuess: string;
  summary: string;
  confidence: number;
}

export class AnalysisError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 털색 팔레트 설명 (AI가 가장 가까운 색을 고르도록) */
const COAT_NAMES: Record<string, string> = {
  '#f7f1e6': '흰색/아이보리', '#f2dcb8': '크림', '#e6b47a': '밝은 황금색/연갈색', '#d98c4a': '적황색(시바 레드)',
  '#b8703a': '갈색', '#7a4a2c': '진갈색/초콜릿', '#3a302c': '검정', '#9a9aa2': '회색/블루', '#e8e4dc': '은백색',
};

const TOOL = {
  name: 'report_dog_features',
  description: '사진 속 강아지의 외형 특징을 미리 정해진 선택지 중에서 골라 보고한다.',
  input_schema: {
    type: 'object',
    properties: {
      is_dog: { type: 'boolean', description: '사진에 강아지가 분명하게 보이면 true' },
      breed: { type: 'string', enum: Object.keys(BREED_PRESETS), description: '가장 비슷한 견종 유형 (해당 없으면 mix)' },
      breed_guess_ko: { type: 'string', description: '추정 견종 이름(한국어, 짧게). 모르면 빈 문자열' },
      size: { type: 'string', enum: [...DOG_SIZES] },
      fur: { type: 'string', enum: [...DOG_FUR], description: 'short=단모, long=장모' },
      coat: { type: 'string', enum: [...COAT_COLORS], description: '가장 넓은 면적의 털색' },
      secondary: { type: 'string', enum: [...COAT_COLORS], description: '두 번째 털색(무늬 색). 무늬가 없으면 coat와 같게' },
      pattern: { type: 'string', enum: [...DOG_PATTERNS], description: 'none=단색, patch=얼룩, saddle=등에 다른 색, mask=얼굴·가슴이 흰색/밝은색, socks=발이 흰색' },
      ear: { type: 'string', enum: [...DOG_EARS], description: 'floppy=늘어진 귀, pointy=쫑긋 선 귀, fold=반쯤 접힌 귀' },
      tail: { type: 'string', enum: [...DOG_TAILS], description: 'curl=등 위로 말린, straight=곧은, fluffy=풍성한, short=짧거나 거의 없음' },
      snout: { type: 'string', enum: [...DOG_SNOUTS], description: '주둥이 길이' },
      summary_ko: { type: 'string', description: '특징 요약 한 문장 (한국어, 40자 이내)' },
      confidence: { type: 'number', description: '0~1 사이 전체 판단 신뢰도' },
    },
    required: ['is_dog', 'breed', 'size', 'fur', 'coat', 'secondary', 'pattern', 'ear', 'tail', 'snout', 'summary_ko', 'confidence'],
  },
};

const PROMPT = `사진 속 반려견의 외형을 분석해 로우폴리 3D 아바타 파츠를 고르세요.
- 반드시 report_dog_features 도구로만 답하세요.
- 각 항목은 주어진 선택지 중 실제 강아지와 가장 비슷한 값을 고릅니다.
- 털색 선택지: ${Object.entries(COAT_NAMES).map(([k, v]) => `${k}=${v}`).join(', ')}
- 사진이 여러 장이면 같은 강아지로 보고 종합해서 판단하세요.
- 강아지가 보이지 않거나 판단이 불가능하면 is_dog=false 로 보고하세요.`;

const LABELS: Record<DogPhoto['kind'], string> = { front: '정면 사진', side: '측면 사진', full: '전신 사진' };

export function createDogAnalyzer(opts: { apiKey?: string; model?: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = opts.model ?? process.env.MUNGLE_AI_MODEL ?? 'claude-sonnet-5-5';
  const baseUrl = (opts.baseUrl ?? process.env.MUNGLE_AI_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 45_000;

  return {
    get available() { return !!apiKey; },
    model,
    async analyze(photos: DogPhoto[]): Promise<DogFeatureResult> {
      if (!apiKey) throw new AnalysisError(503, 'AI 분석이 아직 설정되지 않았어요.');
      const content: object[] = [];
      for (const p of photos) {
        content.push({ type: 'text', text: LABELS[p.kind] });
        content.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } });
      }
      content.push({ type: 'text', text: PROMPT });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model,
            max_tokens: 800,
            tools: [TOOL],
            tool_choice: { type: 'tool', name: TOOL.name },
            messages: [{ role: 'user', content }],
          }),
        });
      } catch (e) {
        throw new AnalysisError(504, (e as Error).name === 'AbortError' ? 'AI 분석 시간이 초과되었어요. 다시 시도해 주세요.' : 'AI 서버에 연결하지 못했어요.');
      } finally { clearTimeout(timer); }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn('[dog-analysis] API 오류', res.status, text.slice(0, 300));
        if (res.status === 429) throw new AnalysisError(429, 'AI 분석 요청이 많아요. 잠시 후 다시 시도해 주세요.');
        throw new AnalysisError(502, 'AI 분석 중 오류가 발생했어요.');
      }
      const data = (await res.json()) as { content?: { type: string; name?: string; input?: any }[] };
      const call = data.content?.find((c) => c.type === 'tool_use' && c.name === TOOL.name);
      const input = call?.input;
      if (!input) throw new AnalysisError(502, 'AI 분석 결과를 읽지 못했어요.');
      if (input.is_dog === false) throw new AnalysisError(422, '사진에서 강아지를 찾지 못했어요. 강아지가 잘 보이는 사진으로 다시 시도해 주세요.');

      // 허용된 파츠 값인지 공용 검증 함수로 다시 확인 (하네스 색은 사용자 설정 유지용 임시값)
      const checked = validateDog({
        breed: input.breed, size: input.size, coat: input.coat, secondary: input.pattern === 'none' ? input.coat : input.secondary,
        pattern: input.pattern, ear: input.ear, tail: input.tail, fur: input.fur, snout: input.snout, harness: HARNESS_COLORS[0],
      });
      if (!checked) throw new AnalysisError(502, 'AI 분석 결과가 올바르지 않아요. 다시 시도해 주세요.');
      const { harness: _h, ...avatar } = checked;
      return {
        avatar,
        breedGuess: typeof input.breed_guess_ko === 'string' ? input.breed_guess_ko.slice(0, 20) : '',
        summary: typeof input.summary_ko === 'string' ? input.summary_ko.slice(0, 80) : '',
        confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
      };
    },
  };
}

export const dogAnalyzer = createDogAnalyzer();

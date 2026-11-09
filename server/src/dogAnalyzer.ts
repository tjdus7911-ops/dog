// AI 강아지 특징 분석 — Claude Vision API (Anthropic Messages API)
// 사진 1~3장(정면/측면/전신)을 보내고, 도구 호출(tool use) 형식으로 "미리 정의된 파츠 값"만 받도록 강제한다.
// → AI가 새 3D 모델을 만들지 않고, 기존 파츠 조합 렌더러에 그대로 들어가는 값만 돌려준다.
// 활성화: 서버 환경 변수 ANTHROPIC_API_KEY (선택: MUNGLE_AI_MODEL, MUNGLE_AI_BASE_URL)
import { FEATURE_PROPERTIES, FEATURE_REQUIRED, PHOTO_LABELS, TOOL_PROMPT, interpretDogFeatures, type DogFeatureResult } from '../../shared/dogAnalysis';

export type { DogFeatureResult };
export interface DogPhoto { kind: 'front' | 'side' | 'full'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }

export class AnalysisError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const TOOL = {
  name: 'report_dog_features',
  description: '사진 속 강아지의 외형 특징을 미리 정해진 선택지 중에서 골라 보고한다.',
  input_schema: { type: 'object', properties: FEATURE_PROPERTIES, required: FEATURE_REQUIRED },
};

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
        content.push({ type: 'text', text: PHOTO_LABELS[p.kind] });
        content.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } });
      }
      content.push({ type: 'text', text: TOOL_PROMPT });

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
      const r = interpretDogFeatures(call?.input);
      if (!r.ok) throw new AnalysisError(r.status, r.error);
      return r.result;
    },
  };
}

export const dogAnalyzer = createDogAnalyzer();

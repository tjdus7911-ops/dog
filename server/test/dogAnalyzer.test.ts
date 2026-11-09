// AI 강아지 분석기 단위 테스트 — 실제 API 대신 가짜 fetch로 요청 형식과 결과 변환을 검증한다.
// 실행: npm run test:ai
import { interpretDogFeatures, jsonPrompt } from '../../shared/dogAnalysis';
import { createDogAnalyzer, AnalysisError, type DogPhoto } from '../src/dogAnalyzer';

let passed = 0, failed = 0;
const check = (name: string, cond: unknown, extra?: unknown) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
};

const photos: DogPhoto[] = [
  { kind: 'front', mediaType: 'image/jpeg', base64: 'AAAA' },
  { kind: 'side', mediaType: 'image/png', base64: 'BBBB' },
];

function fakeFetch(reply: { status?: number; body: unknown }, capture?: (url: string, init: RequestInit) => void): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    capture?.(url, init);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const goodInput = {
  is_dog: true, breed: 'corgi', breed_guess_ko: '웰시코기', size: 'small', fur: 'short', coat: '#d98c4a', secondary: '#f7f1e6',
  pattern: 'socks', ear: 'pointy', tail: 'short', snout: 'medium', summary_ko: '주황빛 털에 흰 발, 쫑긋한 귀', confidence: 0.86,
};
const toolReply = (input: object) => ({ content: [{ type: 'tool_use', id: 't1', name: 'report_dog_features', input }] });

async function main() {
  console.log('\n[AI 강아지 분석]');
  const off = createDogAnalyzer({ apiKey: '' });
  check('키가 없으면 비활성 상태', off.available === false);
  try { await off.analyze(photos); check('키 없이 분석 시 오류', false); } catch (e) { check('키 없이 분석 시 503', e instanceof AnalysisError && e.status === 503); }

  let url = '', init: RequestInit = {};
  const ai = createDogAnalyzer({ apiKey: 'test-key', model: 'claude-test', baseUrl: 'https://example.test', fetchImpl: fakeFetch({ body: toolReply(goodInput) }, (u, i) => { url = u; init = i; }) });
  const r = await ai.analyze(photos);
  const body = JSON.parse(String(init.body));
  const headers = init.headers as Record<string, string>;
  check('Messages API 엔드포인트 호출', url === 'https://example.test/v1/messages');
  check('API 키·버전 헤더', headers['x-api-key'] === 'test-key' && headers['anthropic-version'] === '2023-06-01');
  check('도구 호출 강제 (파츠 값만 받도록)', body.tool_choice?.name === 'report_dog_features' && body.tools[0].input_schema.properties.ear.enum.includes('pointy'));
  check('사진 2장이 이미지 블록으로 전송', body.messages[0].content.filter((c: any) => c.type === 'image').length === 2 && body.messages[0].content[1].source.media_type === 'image/jpeg');
  check('결과를 파츠 값으로 변환', r.avatar.breed === 'corgi' && r.avatar.pattern === 'socks' && r.avatar.ear === 'pointy' && r.avatar.coat === '#d98c4a');
  const photoColor = interpretDogFeatures({ ...goodInput, coat: '#E39B4C', secondary: '#fff', pattern: 'mask' });
  check('사진 속 실제 털색(#rrggbb) 그대로 사용', photoColor.ok && photoColor.result.avatar.coat === '#e39b4c' && photoColor.result.avatar.secondary === '#ffffff');
  const badColor = interpretDogFeatures({ ...goodInput, coat: 'orange' });
  check('잘못된 털색은 기본 색으로 대체', badColor.ok && /^#[0-9a-f]{6}$/.test(badColor.result.avatar.coat));
  const detail = interpretDogFeatures({ ...goodInput, marking: 'blaze', ear_size: 'large', build: 'chubby', body_length: 'long', leg_length: 'normal' });
  check('세부 특징(얼굴 무늬·귀 크기·몸매·몸/다리 길이) 반영', detail.ok && detail.result.avatar.marking === 'blaze' && detail.result.avatar.earSize === 'large' && detail.result.avatar.build === 'chubby' && detail.result.avatar.bodyLen === 'long' && detail.result.avatar.legLen === 'normal');
  const noDetail = interpretDogFeatures({ ...goodInput, marking: 'stripes' });
  check('세부 특징이 없거나 이상하면 기본값', noDetail.ok && noDetail.result.avatar.marking === 'none' && noDetail.result.avatar.legLen === 'short');
  check('미리보기용 JSON 질문에 사진 종류·항목 포함', jsonPrompt(['front', 'side']).includes('정면 사진, 측면 사진') && jsonPrompt(['front']).includes('ear: string'));
  check('추정 견종·요약·신뢰도', r.breedGuess === '웰시코기' && r.summary.length > 0 && r.confidence === 0.86);
  check('결과에 하네스 색 미포함 (사용자 설정 유지)', !('harness' in r.avatar));

  const notDog = createDogAnalyzer({ apiKey: 'k', fetchImpl: fakeFetch({ body: toolReply({ ...goodInput, is_dog: false }) }) });
  try { await notDog.analyze(photos); check('강아지 없음 오류', false); } catch (e) { check('강아지가 없는 사진은 422', e instanceof AnalysisError && e.status === 422); }

  const bad = createDogAnalyzer({ apiKey: 'k', fetchImpl: fakeFetch({ body: toolReply({ ...goodInput, ear: 'antenna', coat: '#123456' }) }) });
  try { await bad.analyze(photos); check('잘못된 값 거부', false); } catch (e) { check('허용 목록 밖의 값은 거부', e instanceof AnalysisError && e.status === 502); }

  const limited = createDogAnalyzer({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429, body: { error: { type: 'rate_limit_error' } } }) });
  try { await limited.analyze(photos); check('요청 제한 처리', false); } catch (e) { check('API 요청 제한(429) 안내', e instanceof AnalysisError && e.status === 429); }

  const plain = createDogAnalyzer({ apiKey: 'k', fetchImpl: fakeFetch({ body: toolReply({ ...goodInput, pattern: 'none', secondary: '#3a302c' }) }) });
  const p = await plain.analyze(photos);
  check('무늬 없음이면 무늬색 = 털색', p.avatar.secondary === p.avatar.coat);

  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

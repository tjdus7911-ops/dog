// 멍글런너 곡 악보 — 멍글마을 자체 편곡 (원곡은 모두 저작권 보호기간이 끝난 퍼블릭 도메인 작품)
// 외부 녹음 음원을 쓰지 않고, 이 악보 데이터로 브라우저에서 직접 피아노 소리를 합성한다.
// 각 곡은 유명한 주제 선율을 중심으로 1분 안팎에 맞춘 축약 편곡이다.
//
// 표기: 'C5:2' = C5 음을 16분음표 2칸 / 'R:4' = 쉼표 4칸 / 'A4+C#5+E5:2' = 화음 / 길이를 빼면 기본 길이
// 장애물 패턴: 마디마다 글자 하나 또는 둘 (둘째 글자는 마디 가운데 칸)
//   J 통나무(점프) · D 높은 막대(숙이기) · P 화분(지금 레인이 막힘 → 옆으로) · F 울타리(빈 레인 하나로) · . 없음
//   화분·울타리의 레인은 패턴 규칙(resolveLanes)이 '한 번 이동으로 피할 수 있게' 정하고, validateChart로 다시 검사한다.

/** [마디 안 16분음표 칸, MIDI 음, 길이(칸), 손(0 오른손 · 1 왼손)] */
export type N = [number, number, number, number];
/** [마디 이름, 템포 배율(클수록 느림), 셈여림 0~1, 2절 여부] */
export type BarPlan = [string, number, number, number];

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 음 이름 → MIDI (C4 = 60) */
export function pitch(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`음 이름 오류: ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
/** 선율: 'C5:2 R:2 D5 C5' → 칸이 이어지는 음표들 */
export function mel(src: string, hand = 0, dflt = 1, start = 0): N[] {
  const out: N[] = [];
  let pos = start;
  for (const tok of src.trim().split(/\s+/)) {
    const [names, l] = tok.split(':');
    const len = l ? Number(l) : dflt;
    if (names !== 'R') for (const n of names.split('+')) out.push([pos, pitch(n), len, hand]);
    pos += len;
  }
  return out;
}
/** 왈츠 반주 (쿵-짝-짝): 근음 + 화음 2번 */
const waltz = (root: string, chord: string): N[] => [[0, pitch(root), 4, 1], ...mel(`${chord.replace(' ', '+')}:3`, 1, 3, 4), ...mel(`${chord.replace(' ', '+')}:3`, 1, 3, 8)];
/** 2/4 행진 반주 (쿵-짝 8분음표) */
const march = (root: string, chord: string): N[] => [
  [0, pitch(root), 2, 1], ...mel(`${chord.replace(' ', '+')}:2`, 1, 2, 2), [4, pitch(root), 2, 1], ...mel(`${chord.replace(' ', '+')}:2`, 1, 2, 6),
];
/** 3/4 4분음표 저음 */
const beats3 = (root: string): N[] => [0, 4, 8].map((p) => [p, pitch(root), 4, 1] as N);
/** 16분음표 연타 (트레몰로) */
const trem = (name: string, n = 12, hand = 0): N[] => Array.from({ length: n }, (_, i) => [i, pitch(name), 1, hand] as N);
/** 16분음표 흐름 (왼손 아르페지오·음계) */
const run = (src: string, hand = 1) => mel(src, hand, 1);

export interface SongDef {
  /** 한 마디의 16분음표 칸 수 / 한 박의 칸 수 (박자선) */
  barLen: number;
  beatLen: number;
  /** 기본 16분음표 길이 (초) */
  sixteenth: number;
  bpm: number;
  bars: Record<string, N[]>;
  plan: BarPlan[];
  /** 장애물 패턴: 마디(plan 순서)마다 토큰, 둘째 글자는 mid 칸 */
  mid: number;
  normal: string;
  hard: string;
}

// ================================================================ 모차르트 — 터키 행진곡 (론도 알라 투르카, 가단조 2/4)
const AM = (): N[] => march('A2', 'C4 E4');
const TURKISH: SongDef = {
  barLen: 8, beatLen: 4, sixteenth: 0.14, bpm: 107,
  bars: {
    intro: [...mel('R:4 B4 A4 G#4 A4')],
    A1: [...mel('C5:2 R:2 D5 C5 B4 C5'), ...AM()],
    A2: [...mel('E5:2 R:2 F5 E5 D#5 E5'), ...AM()],
    A3: [...mel('B5 A5 G#5 A5 B5 A5 G#5 A5'), ...AM()],
    A4: [...mel('C6:4 A5:2 C6:2'), ...AM()],
    A5: [...mel('B5:2 A5:2 G5:2 A5:2'), ...march('E2', 'G3 B3')],
    A6: [...mel('B5:2 A5:2 G5:2 A5:2'), ...AM()],
    A7: [...mel('B5:2 A5:2 G5:2 F#5:2'), ...march('B2', 'D#3 A3')],
    A8: [...mel('E5:4 B4 A4 G#4 A4'), ...march('E2', 'G#3 B3')],
    A8e: [...mel('E5:4 R:4'), ...march('E2', 'G#3 B3')],
    B1: [...mel('E5:2 F5:2 G5:2 G5:2'), ...march('C3', 'E3 G3')],
    B2: [...mel('A5 G5 F5 E5 D5:4'), ...march('G2', 'F3 B3')],
    B5: [...mel('C5:2 D5:2 E5:2 E5:2'), ...AM()],
    B6: [...mel('F5 E5 D5 C5 B4:4'), ...march('E2', 'G#3 D4')],
    B7: [...mel('C5:2 D5:2 E5 D5 C5 B4'), ...AM()],
    B8: [...mel('A4:4 B4 A4 G#4 A4'), ...march('E2', 'G#3 B3')],
    M1: [...mel('C#5:2 E5:2 A5:2 E5:2'), ...march('A2', 'C#4 E4')],
    M2: [...mel('B4:2 E5:2 G#5:2 E5:2'), ...march('E2', 'G#3 D4')],
    M3: [...mel('C#5:2 E5:2 A5:2 C#6:2'), ...march('A2', 'C#4 E4')],
    M4: [...mel('B5 C#6 B5 A5 G#5:4'), ...march('E2', 'G#3 D4')],
    M7: [...mel('C#5:2 B4:2 A4:2 G#4:2'), ...march('E2', 'G#3 D4')],
    END: [...mel('A4+C#5+E5+A5:8'), [0, pitch('A2'), 8, 1], [0, pitch('A3'), 8, 1]],
  },
  plan: [
    ['intro', 1.02, 0.5, 0],
    ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].map((b): BarPlan => [b, 1, 0.6, 0]),
    ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].map((b): BarPlan => [b, 1, 0.66, 0]),
    ...['B1', 'B2', 'B1', 'B2', 'B5', 'B6', 'B7', 'B8'].map((b): BarPlan => [b, 0.98, 0.7, 0]),
    ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8e'].map((b, i): BarPlan => [b, i === 7 ? 1.06 : 1, 0.68, 1]),
    ...['M1', 'M2', 'M3', 'M4', 'M1', 'M2', 'M3', 'M7'].map((b, i): BarPlan => [b, i >= 6 ? 1.08 : 0.97, 0.8, 1]),
    ['END', 1.4, 0.75, 1],
  ],
  mid: 4,
  //          intro | A (1~8)         | A 반복           | B                  | A 끝              | 행진 후렴         | 끝
  normal: '.  P J D J F J D J  P J D J F JD J J  P J D J F J D J  P J D J F J D .  J P D F J P D J  .',
  hard:   '.  P JD J D F J DJ J  P JD J DJ F J D JP  P JD J D F JD J J  P J DJ J F JD J .  JP J DJ F JP J D J  .',
};

// ================================================================ 요한 슈트라우스 2세 — 아름답고 푸른 도나우 (라장조 3/4 왈츠)
const D = (): N[] => waltz('D2', 'F#3 A3');
const A7 = (): N[] => waltz('A2', 'E3 G3');
const DANUBE: SongDef = {
  barLen: 12, beatLen: 4, sixteenth: 0.1, bpm: 150,
  bars: {
    i1: [...mel('A3+D4+F#4:12', 0, 12), ...D()],
    i2: [...mel('R:8 D4:4'), ...D()],
    W1: [...mel('D4:4 D4:4 F#4:4'), ...D()],
    W2: [...mel('A4:8 R:4'), ...D()],
    W3: [...mel('A5:4 A5:4 R:4'), ...D()],
    W4: [...mel('F#5:4 F#5:4 R:4'), ...D()],
    W7: [...mel('A5:4 A5:4 R:4'), ...A7()],
    W8: [...mel('G5:4 G5:4 R:4'), ...A7()],
    W9: [...mel('C#4:4 C#4:4 E4:4'), ...A7()],
    W10: [...mel('B4:8 R:4'), ...A7()],
    W11: [...mel('B5:4 B5:4 R:4'), ...A7()],
    W16: [...mel('F#5:4 F#5:4 R:4'), ...D()],
    W18: [...mel('A4:4 D5:4 R:4'), ...D()],
    W19: [...mel('D6:4 D6:4 R:4'), ...D()],
    W20: [...mel('A5:4 A5:4 R:4'), ...D()],
    W23: [...mel('D6:4 D6:4 R:4'), ...waltz('G2', 'B3 D4')],
    W24: [...mel('B5:4 B5:4 R:4'), ...waltz('G2', 'B3 D4')],
    W25: [...mel('E4:4 E4:4 G4:4'), ...waltz('E2', 'G3 B3')],
    W26: [...mel('B4:8 R:4'), ...waltz('E2', 'G3 B3')],
    W27: [...mel('B5:4 B5:4 R:4'), ...A7()],
    W28: [...mel('A5:4 F#5:4 R:4'), ...D()],
    W29: [...mel('E5:8 R:4'), ...A7()],
    W30: [...mel('D5:8 R:4'), ...D()],
    END: [...mel('D4+F#4+A4+D5:12', 0, 12), [0, pitch('D2'), 12, 1], [0, pitch('D3'), 12, 1]],
  },
  plan: [
    ['i1', 1.05, 0.4, 0], ['i2', 1.05, 0.45, 0],
    ...['W1', 'W2', 'W3', 'W4', 'W1', 'W2', 'W7', 'W8', 'W9', 'W10', 'W11', 'W8', 'W9', 'W10', 'W11', 'W16'].map((b, i): BarPlan => [b, i % 4 === 3 ? 1.04 : 1, 0.55, 0]),
    ...['W1', 'W18', 'W19', 'W20', 'W1', 'W18', 'W23', 'W24', 'W25', 'W26', 'W27', 'W28', 'W29', 'W30'].map((b, i): BarPlan => [b, i % 4 === 3 ? 1.04 : 1, 0.62, 0]),
    ...['W1', 'W18', 'W19', 'W20', 'W1', 'W18', 'W23', 'W24', 'W25', 'W26', 'W27', 'W28', 'W29', 'W30'].map((b, i): BarPlan => [b, i >= 12 ? 1.12 : 0.98, 0.72, 1]),
    ['END', 1.4, 0.6, 1],
  ],
  mid: 8,
  //        도입 | 1주제 (16마디)                      | 2주제 (14마디)                   | 2주제 반복 (14마디)               | 끝
  normal: '. .  P J D J F . J D P J D . J J D .  P J D . F J D . J P D J . .  J P D J F . J D P J D J . .  .',
  hard:   '. .  P J D J F J J D P J D J J J D J  P J D J F J D J J P D J J .  J P D J F J J D P J D J J .  .',
};

// ================================================================ 쇼팽 — 혁명 연습곡 Op.10-12 (다단조 4/4)
const CM = 'C3 G3 C4 D4 Eb4 D4 C4 G3 C3 G3 C4 D4 Eb4 D4 C4 G3';
const FM = 'F2 C3 F3 Ab3 C4 Ab3 F3 C3 F2 C3 F3 Ab3 C4 Ab3 F3 C3';
const G7 = 'G2 B2 D3 F3 G3 F3 D3 B2 G2 B2 D3 F3 G3 F3 D3 B2';
const AB = 'Ab2 Eb3 Ab3 C4 Eb4 C4 Ab3 Eb3 Ab2 Eb3 Ab3 C4 Eb4 C4 Ab3 Eb3';
const EB = 'Eb2 Bb2 Eb3 G3 Bb3 G3 Eb3 Bb2 Eb2 Bb2 Eb3 G3 Bb3 G3 Eb3 Bb2';
const DOWN = 'G5 F5 D5 B4 Ab4 F4 D4 B3 G3 F3 D3 B2 G2 F2 D2 B1';
const REVOLUTIONARY: SongDef = {
  barLen: 16, beatLen: 4, sixteenth: 0.095, bpm: 158,
  bars: {
    I1: [...mel('G4+B4+D5+F5:8 R:8'), ...run(DOWN)],
    I2: [...mel('Ab4+B4+D5+F5:8 R:8'), ...run(DOWN)],
    I3: [...mel('G4+G5:8 R:8'), ...run(G7)],
    I4: [...run(CM)],
    T1: [...mel('C5+C6:6 D5+D6:2 Eb5+Eb6:4 F5+F6:4'), ...run(CM)],
    T2: [...mel('G5+G6:8 Ab5+Ab6:2 G5+G6:2 F5+F6:2 Eb5+Eb6:2'), ...run(CM)],
    T3: [...mel('D5+D6:6 Eb5+Eb6:2 F5+F6:4 D5+D6:4'), ...run(G7)],
    T4: [...mel('B4+B5:8 G4+G5:8'), ...run(G7)],
    T5: [...mel('C5+C6:6 D5+D6:2 Eb5+Eb6:4 G5+G6:4'), ...run(CM)],
    T6: [...mel('Ab5+Ab6:8 G5+G6:4 F5+F6:4'), ...run(FM)],
    T7: [...mel('Eb5+Eb6:4 D5+D6:4 C5+C6:4 B4+B5:4'), ...run(G7)],
    T8: [...mel('C5+C6:12 R:4'), ...run(CM)],
    M1: [...mel('Eb5+Eb6:6 F5+F6:2 G5+G6:4 Ab5+Ab6:4'), ...run(AB)],
    M2: [...mel('Bb5+Bb6:8 Ab5+Ab6:4 G5+G6:4'), ...run(EB)],
    M3: [...mel('F5+F6:6 G5+G6:2 Ab5+Ab6:4 F5+F6:4'), ...run(FM)],
    M4: [...mel('D5+D6:8 B4+B5:8'), ...run(G7)],
    C1: [...mel('C4+Eb4+G4+C5:8 R:8'), ...run('C5 G4 Eb4 C4 G3 Eb3 C3 G2 C3 Eb3 G3 C4 Eb4 G4 C5 Eb5')],
    C3: [...mel('C4+Eb4+G4+C5+Eb5+G5:16', 0, 16), [0, pitch('C2'), 16, 1], [0, pitch('C3'), 16, 1]],
  },
  plan: [
    ['I1', 1.02, 0.75, 0], ['I2', 1.02, 0.78, 0], ['I3', 1, 0.7, 0], ['I4', 1, 0.6, 0],
    ...['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map((b): BarPlan => [b, 1, 0.68, 0]),
    ...['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map((b): BarPlan => [b, 0.98, 0.76, 1]),
    ...['M1', 'M2', 'M3', 'M4'].map((b): BarPlan => [b, 1, 0.72, 0]),
    ...['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map((b, i): BarPlan => [b, i >= 6 ? 1.06 : 0.98, 0.82, 1]),
    ['C1', 1.02, 0.85, 1], ['C1', 1.06, 0.85, 1], ['C3', 1.5, 0.8, 1],
  ],
  mid: 8,
  //        도입    | 주제               | 주제 (강하게)        | 가운데     | 주제 다시            | 끝
  normal: 'J . D .  P J D J F J D J  PJ D JD J FJ D J J  P J D J  P J D JD F J D J  J D .',
  hard:   'J D D J  PJ D JD J FJ D JP J  PJ DJ JD J FJ DJ JP J  PJ D JD J  PJ D JD JP FJ D JD J  J D .',
};

// ================================================================ 비발디 — 사계 중 '여름' 3악장 프레스토 (사단조 3/4)
const VIVALDI: SongDef = {
  barLen: 12, beatLen: 4, sixteenth: 0.102, bpm: 147,
  bars: {
    S1: [...trem('G4'), ...beats3('G2')],
    S2: [...trem('G5'), ...beats3('G2')],
    S3: [...run('G5 F#5 Eb5 D5 C5 Bb4 A4 G4 F#4 Eb4 D4 C4', 0), ...beats3('G2')],
    S4: [...mel('G4+Bb4+D5:2 R:2 G4+Bb4+D5:2 R:2 D4+F#4+A4+C5:4'), ...mel('G2:4 G2:4 D2:4', 1)],
    C1: [...trem('C5'), ...beats3('C3')],
    C2: [...trem('Eb5'), ...beats3('C3')],
    C3: [...run('C6 Bb5 A5 G5 F#5 Eb5 D5 C5 Bb4 A4 G4 F#4', 0), ...beats3('D2')],
    C4: [...mel('D4+F#4+A4:4 D4+F#4+A4:4 G4+Bb4+D5:4'), ...mel('D2:4 D2:4 G2:4', 1)],
    A1: [...run('G4 Bb4 D5 G5 Bb5 D6 G6 D6 Bb5 G5 D5 Bb4', 0), ...beats3('G2')],
    A2: [...run('F#4 A4 C5 D5 F#5 A5 C6 A5 F#5 D5 C5 A4', 0), ...beats3('D2')],
    A3: [...run('Eb4 G4 Bb4 Eb5 G5 Bb5 Eb6 Bb5 G5 Eb5 Bb4 G4', 0), ...beats3('Eb2')],
    A4: [...run('D4 F#4 A4 D5 F#5 A5 D6 A5 F#5 D5 A4 F#4', 0), ...beats3('D2')],
    END: [...mel('G3+D4+G4+Bb4+D5+G5:12', 0, 12), [0, pitch('G1'), 12, 1], [0, pitch('G2'), 12, 1]],
  },
  plan: [
    ['S1', 1.04, 0.5, 0],
    ...['S1', 'S2', 'S3', 'S4', 'S1', 'S2', 'S3', 'S4'].map((b): BarPlan => [b, 1, 0.66, 0]),
    ...['C1', 'C2', 'C3', 'C4'].map((b): BarPlan => [b, 1, 0.7, 0]),
    ...['A1', 'A2', 'A3', 'A4', 'A1', 'A2', 'A3', 'A4'].map((b): BarPlan => [b, 0.99, 0.74, 1]),
    ...['S1', 'S2', 'S3', 'S4'].map((b): BarPlan => [b, 0.98, 0.8, 1]),
    ...['C1', 'C2', 'C3', 'C4'].map((b): BarPlan => [b, 0.98, 0.8, 1]),
    ...['A1', 'A2', 'A3', 'A4'].map((b): BarPlan => [b, 0.98, 0.84, 1]),
    ['S1', 1, 0.85, 1], ['S3', 1.04, 0.86, 1], ['S4', 1.12, 0.86, 1], ['END', 1.5, 0.8, 1],
  ],
  // 둘째 장애물은 마디 가운데(칸 6) — 16분음표가 쉬지 않고 이어지는 곡이라 모든 칸에 음이 있음
  mid: 6,
  //        시작 | 트레몰로·음계 (8)    | 다단조 (4) | 아르페지오 (8)       | 다시 (4) | 다단조 (4) | 아르페지오 (4) | 끝
  normal: '.  P J D J F J D J  P J D J  J P D F J P D J  P J D J  F J D J  P J D J  J D J .',
  hard:   '.  PJ JD DJ J FJ JP DJ J  PJ J DJ J  J PJ D FJ J PJ DJ J  PJ J DJ J  FJ J DJ J  PJ J DJ J  J D J .',
};

export const SONG_DEFS: Record<string, SongDef> = { turkish: TURKISH, danube: DANUBE, revolutionary: REVOLUTIONARY, summer: VIVALDI };

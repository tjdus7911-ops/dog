// AI 강아지 특징 분석 — 연결 지점(인터페이스)만 정의한다.
// 현재 실제 AI API는 연결되어 있지 않으며, 클라이언트도 분석 기능을 제공하는 것처럼 표시하지 않는다.
// 추후 Vision API를 연결할 때 analyze()가 사진 3장(정면/측면/전신)을 받아
// 미리 정의된 파츠 값(DogAvatar)만 반환하도록 구현하면 기존 파츠 조합 렌더러를 그대로 쓸 수 있다.
import type { DogAvatar } from '../../shared/avatar';

export interface DogFeatureResult {
  avatar: Omit<DogAvatar, 'harness'>;
  confidence: Partial<Record<keyof Omit<DogAvatar, 'harness'>, number>>;
}

export interface DogFeatureAnalyzer {
  readonly available: boolean;
  analyze(photos: { front: Buffer; side: Buffer; full: Buffer }): Promise<DogFeatureResult>;
}

export const dogAnalyzer: DogFeatureAnalyzer = {
  available: false,
  async analyze() {
    throw new Error('AI 분석 API가 아직 연결되지 않았습니다.');
  },
};

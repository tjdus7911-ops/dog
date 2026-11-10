// 광장 대형 스크린 슬라이드 (작성자 공개 동의 + 운영자 승인을 거친 콘텐츠만)
export interface ScreenSlide {
  id: number;
  kind: 'dog' | 'notice' | 'meetup' | 'runner';
  label: string;
  title: string;
  text: string;
  image: string | null;
  author: string;
  authorId: number;
  dogName: string | null;
  ts: number;
  /** kind='runner': 코스 id와 TOP 3 */
  course?: string;
  ranking?: { rank: number; nickname: string; dogName: string; score: number; coat: string }[];
}

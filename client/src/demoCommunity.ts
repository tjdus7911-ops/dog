// 미리보기(데모) 전용 멍글 동네 — 서버 없이 이 브라우저 안에서만 동작 (다른 사용자 없음, 미리 넣어 둔 가짜 글 없음)
import type { MyProfile } from '@shared/protocol';
import { PARKS } from '@shared/protocol';
import { SHOP_ITEMS } from '@shared/home';
import { CLUB_CATEGORIES, ONLINE_REGION, SIDO, SIZE_RULES, TEMPER_RULES, type AuthorSummary, type PostView } from '@shared/community';

const KEY = 'mungle.demo.community';
interface Post { id: number; text: string; image: string | null; ts: number; clubId: number | null; liked: boolean; saved: boolean; comments: { id: number; text: string; ts: number }[] }
interface Meetup { id: number; title: string; intro: string; kind: 'online' | 'offline'; region: string; place: string; park: string | null; startsAt: number; capacity: number; sizeRule: string; temperRule: string; approval: 'auto' | 'manual'; status: 'open' | 'cancelled'; messages: { id: number; text: string; ts: number }[]; review: { rating: number; text: string; ts: number } | null }
interface Club { id: number; name: string; category: string; intro: string; official: boolean; joined: boolean; owner: boolean }
interface Data { seq: number; region: string; posts: Post[]; meetups: Meetup[]; clubs: Club[]; claimed: string[] }

const OFFICIAL: Club[] = [
  { id: 1, name: '소형견 모임', category: 'size', intro: '말티즈·포메·푸들 등 작은 친구들의 모임', official: true, joined: false, owner: false },
  { id: 2, name: '중형견 모임', category: 'size', intro: '시바·코기·비글 등 중형견 보호자 모임', official: true, joined: false, owner: false },
  { id: 3, name: '대형견 모임', category: 'size', intro: '리트리버·허스키 등 큰 친구들의 모임', official: true, joined: false, owner: false },
  { id: 4, name: '믹스견 모임', category: 'mix', intro: '세상에 하나뿐인 믹스견 자랑 모임', official: true, joined: false, owner: false },
];
function load(): Data {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* 무시 */ }
  return { seq: 100, region: '', posts: [], meetups: [], clubs: OFFICIAL.map((c) => ({ ...c })), claimed: [] };
}
let mem: Data | null = null;
const data = () => (mem ??= load());
function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* 이번 세션에서만 유지 */ } }
export const demoClaimed = () => data().claimed;

export function demoCommunity(path: string, opts: { method?: string; body?: any }, me: MyProfile): any {
  const d = data();
  const b = opts.body ?? {};
  const m = opts.method ?? (opts.body ? 'POST' : 'GET');
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs ?? '');
  const author: AuthorSummary = { id: me.id, nickname: me.nickname, dogName: me.dogName, dogPhoto: me.dogPhoto, dogCoat: me.dog.coat, residence: me.residence };
  const fail = (msg: string) => { throw new Error(msg); };
  const done = <T,>(v: T) => { save(); return v; };
  const seg = p.split('/').filter(Boolean); // api, posts, 1, like

  if (p === '/api/me/region') {
    if (m === 'PUT') { if (!(SIDO as readonly string[]).includes(b.sido)) fail('시·도를 골라 주세요.'); d.region = b.dong ? `${b.sido} ${b.dong}` : b.sido; return done({ region: d.region }); }
    return { region: d.region };
  }
  // ---- 강아지 자랑 ----
  const postView = (x: Post): PostView => ({ id: x.id, author, text: x.text, image: x.image, ts: x.ts, likes: x.liked ? 1 : 0, likedByMe: x.liked, savedByMe: x.saved, comments: x.comments.length, clubId: x.clubId, screen: 'none', canDelete: true });
  if (p === '/api/posts' && m === 'GET') {
    const club = Number(q.get('club')) || null, scope = q.get('scope'), before = Number(q.get('before')) || Infinity;
    return { posts: d.posts.filter((x) => x.id < before && (club ? x.clubId === club : !x.clubId) && (scope !== 'saved' || x.saved)).sort((a, c) => c.id - a.id).map(postView) };
  }
  if (p === '/api/posts') {
    if (!String(b.text ?? '').trim()) fail('내용을 입력해 주세요.');
    if (!b.clubId && !b.photo) fail('강아지 사진을 함께 올려 주세요.');
    const x: Post = { id: ++d.seq, text: String(b.text).slice(0, 500), image: b.photo ?? null, ts: Date.now(), clubId: b.clubId ?? null, liked: false, saved: false, comments: [] };
    d.posts.push(x);
    return done({ post: postView(x) });
  }
  if (seg[1] === 'posts' || seg[1] === 'comments') {
    if (seg[1] === 'comments') { for (const x of d.posts) x.comments = x.comments.filter((c) => c.id !== Number(seg[2])); return done({ ok: true }); }
    const x = d.posts.find((y) => y.id === Number(seg[2])) ?? fail('글을 찾을 수 없어요.');
    if (!seg[3]) { d.posts = d.posts.filter((y) => y !== x); return done({ ok: true }); }
    if (seg[3] === 'like') { x.liked = !x.liked; return done({ post: postView(x) }); }
    if (seg[3] === 'save') { x.saved = !x.saved; return done({ post: postView(x) }); }
    if (seg[3] === 'report') fail('미리보기에서는 신고할 다른 사용자가 없어요.');
    if (seg[3] === 'comments') {
      if (m === 'POST') { if (!String(b.text ?? '').trim()) fail('댓글을 입력해 주세요.'); x.comments.push({ id: ++d.seq, text: String(b.text).slice(0, 200), ts: Date.now() }); save(); }
      return { comments: x.comments.map((c) => ({ id: c.id, author, text: c.text, ts: c.ts, canDelete: true })) };
    }
  }
  // ---- 산책 모임 ----
  const mv = (x: Meetup) => ({
    id: x.id, host: author, title: x.title, intro: x.intro, kind: x.kind, region: x.region, place: x.place, park: x.park, startsAt: x.startsAt, capacity: x.capacity,
    sizeRule: x.sizeRule, temperRule: x.temperRule, approval: x.approval, status: x.status, approvedCount: 1, pendingCount: 0, myStatus: 'approved', isHost: true,
    ended: x.startsAt + 3 * 3600_000 < Date.now(), reviewCount: x.review ? 1 : 0, avgRating: x.review?.rating ?? null,
  });
  const md = (x: Meetup) => ({ ...mv(x), members: [{ user: author, status: 'approved', isHost: true }], reviews: x.review ? [{ user: author, ...x.review }] : [], myReview: !!x.review });
  if (p === '/api/meetups' && m === 'GET') {
    const scope = q.get('scope'), region = q.get('region') ?? '';
    const now = Date.now();
    return { meetups: d.meetups.filter((x) => (scope === 'mine' ? true : scope === 'past' ? x.startsAt < now && x.status === 'open' : x.startsAt > now - 3600_000 && x.status === 'open') && (!region || x.region.startsWith(region))).sort((a, c) => a.startsAt - c.startsAt).map(mv) };
  }
  if (p === '/api/meetups') {
    if (!String(b.title ?? '').trim()) fail('모임 이름을 입력해 주세요.');
    if (!(b.startsAt > Date.now() + 10 * 60_000)) fail('모임 날짜는 10분 뒤부터 정해 주세요.');
    if (!(b.capacity >= 2 && b.capacity <= 30)) fail('정원은 2~30명으로 정해 주세요.');
    let region = ONLINE_REGION, place = '', park: string | null = null;
    if (b.kind === 'online') { park = b.park ?? PARKS[0].id; place = `멍글마을 ${PARKS.find((x) => x.id === park)?.name} 분수대`; }
    else { if (!(SIDO as readonly string[]).includes(b.sido)) fail('동네(시·도)를 골라 주세요.'); if (!String(b.place ?? '').trim()) fail('모일 장소를 입력해 주세요.'); region = b.dong ? `${b.sido} ${b.dong}` : b.sido; place = String(b.place).slice(0, 40); }
    const x: Meetup = { id: ++d.seq, title: String(b.title).slice(0, 30), intro: String(b.intro ?? '').slice(0, 300), kind: b.kind === 'online' ? 'online' : 'offline', region, place, park, startsAt: b.startsAt, capacity: b.capacity,
      sizeRule: SIZE_RULES.some((s) => s.id === b.sizeRule) ? b.sizeRule : 'any', temperRule: TEMPER_RULES.some((s) => s.id === b.temperRule) ? b.temperRule : 'any', approval: b.approval === 'manual' ? 'manual' : 'auto', status: 'open', messages: [], review: null };
    d.meetups.push(x);
    return done({ meetup: mv(x) });
  }
  if (seg[1] === 'meetups') {
    const x = d.meetups.find((y) => y.id === Number(seg[2])) ?? fail('모임을 찾을 수 없어요.');
    if (!seg[3]) return { meetup: md(x) };
    if (seg[3] === 'cancel') { x.status = 'cancelled'; return done({ meetup: md(x) }); }
    if (seg[3] === 'leave') fail('모임장은 참가 취소 대신 모임을 취소해 주세요.');
    if (seg[3] === 'messages') {
      if (m === 'POST') { if (!String(b.text ?? '').trim()) fail('메시지를 입력해 주세요.'); const msg = { id: ++d.seq, text: String(b.text).slice(0, 200), ts: Date.now() }; x.messages.push(msg); save(); return { message: { ...msg, user: author } }; }
      return { messages: x.messages.map((y) => ({ ...y, user: author })) };
    }
    if (seg[3] === 'reviews') { if (x.startsAt > Date.now()) fail('모임이 끝난 뒤 후기를 쓸 수 있어요.'); x.review = { rating: b.rating, text: String(b.text ?? ''), ts: Date.now() }; return done({ meetup: md(x) }); }
    fail('미리보기에서는 다른 참가자가 없어요.');
  }
  // ---- 강아지 모임 ----
  const cv = (c: Club) => ({ id: c.id, name: c.name, category: c.category, intro: c.intro, official: c.official, memberCount: c.joined ? 1 : 0, postCount: d.posts.filter((x) => x.clubId === c.id).length, isMember: c.joined, isOwner: c.owner });
  if (p === '/api/clubs' && m === 'GET') {
    const cat = q.get('category');
    return { clubs: d.clubs.filter((c) => (q.get('scope') === 'mine' ? c.joined : !cat || c.category === cat)).map(cv) };
  }
  if (p === '/api/clubs') {
    const name = String(b.name ?? '').trim().slice(0, 20);
    if (!name) fail('모임 이름을 입력해 주세요.');
    if (!CLUB_CATEGORIES.some((c) => c.id === b.category)) fail('모임 종류를 골라 주세요.');
    if (d.clubs.some((c) => c.name === name)) fail('같은 이름의 모임이 있어요.');
    const c: Club = { id: ++d.seq, name, category: b.category, intro: String(b.intro ?? '').slice(0, 200), official: false, joined: true, owner: true };
    d.clubs.unshift(c);
    return done({ club: cv(c) });
  }
  if (seg[1] === 'clubs') {
    const c = d.clubs.find((y) => y.id === Number(seg[2])) ?? fail('모임을 찾을 수 없어요.');
    if (seg[3] === 'join') { c.joined = true; return done({ club: cv(c) }); }
    if (seg[3] === 'leave') { if (c.owner) fail('모임장은 탈퇴할 수 없어요.'); c.joined = false; return done({ club: cv(c) }); }
    return { club: { ...cv(c), members: c.joined ? [{ user: author, role: c.owner ? 'owner' : 'member' }] : [] } };
  }
  // ---- 애견샵 ----
  if (p === '/api/shop') return { items: SHOP_ITEMS.map((i) => ({ ...i, claimed: d.claimed.includes(i.id) })) };
  if (seg[1] === 'shop' && seg[3] === 'claim') {
    if (!me.residence) fail('아파트에 입주한 뒤 받을 수 있어요.');
    if (!SHOP_ITEMS.some((i) => i.id === seg[2])) fail('없는 상품이에요.');
    if (!d.claimed.includes(seg[2])) d.claimed.push(seg[2]);
    return done({ ok: true });
  }
  return undefined;
}

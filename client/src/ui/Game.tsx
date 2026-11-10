import { lazy, Suspense } from 'react';
import { Scene } from '../game/Scene';
import { useStore } from '../store';
import { TopBar } from './TopBar';
import { MiniMap } from './MiniMap';
import { ChatPanel } from './ChatPanel';
import { ActionBar, Joystick } from './Controls';
import { FriendsPanel } from './FriendsPanel';
import { ProfilePopup, ReportDialog } from './ProfilePopup';
import { DmWindow } from './DmWindow';
import { NotificationsPanel } from './NotificationsPanel';
import { SettingsPanel } from './SettingsPanel';
import { ConnectionOverlay } from './ConnectionOverlay';
import { BenchMenu } from './BenchMenu';
import { PhotoModeBar, ScreenDetail, ScreenSubmit } from './Photo';
import { LobbyPanel } from './Apartment';
import { CafeBar, ShopBar } from './Places';
import { InteractBar, InteractionOverlays, useOverlayOpen } from './Interact';
import { Community, MeetupAlert } from './Community';
import { isTouchDevice } from '../game/input';
import { BottomNav, EventsPanel, MoreSheet, PlaceBar, QuickMenu, VillageMap } from './MobileHud';
import { HomeEditor, HomePanel } from './Home';

const AvatarEditor = lazy(() => import('./AvatarEditor'));
const AdminPanel = lazy(() => import('./AdminPanel'));

export default function Game() {
  const panel = useStore((s) => s.panel);
  const popup = useStore((s) => s.profilePopup);
  const report = useStore((s) => s.reportTarget);
  const dmWith = useStore((s) => s.dmWith);
  const kind = useStore((s) => s.park?.kind ?? 'park');
  const homeEdit = useStore((s) => s.homeEdit);
  const photo = useStore((s) => s.photoMode);
  // 멍글 동네가 열려 있으면 조이스틱·액션 버튼을 숨김 (모바일은 채팅·미니맵도 숨겨 겹침 방지)
  const community = useStore((s) => !!s.community);
  const touch = isTouchDevice();
  const chatOpen = useStore((s) => s.chatOpen);
  const moreOpen = useStore((s) => s.moreOpen);
  // 강아지 메뉴·프로필·사진 보기·가입 안내가 열리면 이동 UI(조이스틱·액션 버튼)를 숨김
  const overlay = useOverlayOpen();
  const mobileChat = touch && chatOpen;
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0"><Scene /></div>
      {!photo && <>
        <TopBar />
        {touch ? <PlaceBar /> : kind === 'park' && !community && <MiniMap />}
        {!community && !overlay && !(touch && (chatOpen || moreOpen)) && <QuickMenu />}
        {!(community && touch) && <ChatPanel />}
        {!community && !overlay && <><ActionBar /><Joystick /></>}
        {!community && !overlay && !mobileChat && !(touch && moreOpen) && <InteractBar />}
        {kind === 'park' && !community && <BenchMenu />}
        {kind === 'lobby' && <LobbyPanel />}
        {kind === 'home' && <HomePanel />}
        {kind === 'cafe' && <CafeBar />}
        {kind === 'shop' && <ShopBar />}
        {!community && <MeetupAlert />}
        {community && <Community />}
        {touch && <><MoreSheet /><BottomNav /></>}
      </>}
      {photo && <PhotoModeBar />}
      {homeEdit && <HomeEditor />}
      <VillageMap />
      <EventsPanel />
      <ScreenDetail />
      <InteractionOverlays />
      <ScreenSubmit />
      {panel === 'friends' && <FriendsPanel />}
      {panel === 'notifications' && <NotificationsPanel />}
      {panel === 'settings' && <SettingsPanel />}
      <Suspense fallback={null}>
        {panel === 'avatar' && <AvatarEditor mode="edit" />}
        {panel === 'admin' && <AdminPanel />}
      </Suspense>
      {dmWith && <DmWindow profile={dmWith} />}
      {popup && <ProfilePopup />}
      {report && <ReportDialog profile={report} />}
      <ConnectionOverlay />
    </div>
  );
}

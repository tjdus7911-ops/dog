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
import { PhotoModeBar, PhotoZonePrompt, ScreenDetail, ScreenSubmit } from './Photo';
import { EntrancePrompt, LobbyPanel } from './Apartment';
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
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0"><Scene /></div>
      {!photo && <>
        <TopBar />
        {kind === 'park' && <MiniMap />}
        <ChatPanel />
        <ActionBar />
        <Joystick />
        {kind === 'park' && <><BenchMenu /><EntrancePrompt /><PhotoZonePrompt /></>}
        {kind === 'lobby' && <LobbyPanel />}
        {kind === 'home' && <HomePanel />}
      </>}
      {photo && <PhotoModeBar />}
      {homeEdit && <HomeEditor />}
      <ScreenDetail />
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

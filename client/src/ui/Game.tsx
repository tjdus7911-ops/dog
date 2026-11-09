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
import { EntrancePrompt, Lobby } from './Apartment';
import { Home } from './Home';

const AvatarEditor = lazy(() => import('./AvatarEditor'));
const AdminPanel = lazy(() => import('./AdminPanel'));

export default function Game() {
  const panel = useStore((s) => s.panel);
  const popup = useStore((s) => s.profilePopup);
  const report = useStore((s) => s.reportTarget);
  const dmWith = useStore((s) => s.dmWith);
  const view = useStore((s) => s.view);
  if (view === 'lobby' || view === 'home') {
    return (
      <div className="relative h-full w-full overflow-hidden">
        {view === 'lobby' ? <Lobby /> : <Home />}
        {dmWith && <DmWindow profile={dmWith} />}
        <ConnectionOverlay />
      </div>
    );
  }
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0"><Scene /></div>
      <TopBar />
      <MiniMap />
      <ChatPanel />
      <ActionBar />
      <Joystick />
      <BenchMenu />
      <EntrancePrompt />
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

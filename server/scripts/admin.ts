// 운영자 관리 명령 (서버에 직접 접속할 수 있을 때)
//   npm run admin -- list               지금 운영자 목록
//   npm run admin -- grant <아이디>      이미 가입한 일반 회원을 운영자로
//   npm run admin -- revoke <아이디>     운영자 권한 회수
// 서버와 같은 데이터 폴더를 써야 해요: 오라클 서버에서는
//   sudo -u mungle bash -c 'set -a; . /etc/mungle.env; cd /opt/mungle/server && npm run admin -- list'
import { all, run } from '../src/db';
import { listAdmins } from '../src/admins';

const [cmd, name] = process.argv.slice(2);
const find = (n: string) => all('SELECT id, username, role FROM users WHERE lower(username) = lower(?)', n)[0];

if (cmd === 'list' || !cmd) {
  const list = listAdmins();
  console.log(list.length ? list.map((u) => `${u.username} (id ${u.id})`).join('\n') : '운영자 계정이 없어요.');
} else if ((cmd === 'grant' || cmd === 'revoke') && name) {
  const u = find(name);
  if (!u) { console.log(`'${name}' 아이디로 가입된 계정이 없어요.`); process.exit(1); }
  if (u.role === 'guest') { console.log('둘러보기(임시) 계정은 운영자로 바꿀 수 없어요.'); process.exit(1); }
  run('UPDATE users SET role = ? WHERE id = ?', cmd === 'grant' ? 'admin' : 'user', u.id);
  console.log(cmd === 'grant' ? `${u.username} 님을 운영자로 지정했어요.` : `${u.username} 님의 운영자 권한을 회수했어요.`);
} else {
  console.log('사용법: npm run admin -- list | grant <아이디> | revoke <아이디>');
  process.exit(1);
}

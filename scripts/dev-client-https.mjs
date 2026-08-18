// Launch the client dev server over HTTPS (secure context required for the
// interview camera/mic). Cross-platform: sets HTTPS=true and spawns Vite via
// the workspace dev script. Used by `npm run dev:client:https` / `dev:https`.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'dev', '--workspace', 'client'], {
  stdio: 'inherit',
  env: { ...process.env, HTTPS: 'true' },
});
child.on('exit', (code) => process.exit(code ?? 0));

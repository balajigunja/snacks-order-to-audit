import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!fs.existsSync('backend/factory.db')) {
  console.log('Initializing and seeding backend/factory.db...');
  spawnSync(npmCmd, ['--prefix', 'backend', 'run', 'db:init'], { stdio: 'inherit', shell: true });
  spawnSync(npmCmd, ['--prefix', 'backend', 'run', 'seed'], { stdio: 'inherit', shell: true });
}

const backend = spawn(npmCmd, ['--prefix', 'backend', 'run', 'dev'], { stdio: 'inherit', shell: true });
const frontend = spawn(npmCmd, ['--prefix', 'frontend', 'run', 'dev'], { stdio: 'inherit', shell: true });

function shutdown() {
  backend.kill();
  frontend.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(scriptDirectory, '..');
const workspaceDirectory = path.resolve(desktopDirectory, '../..');
const serverEntry = path.join(workspaceDirectory, 'apps', 'server', 'dist', 'index.js');
const binaryDirectory = path.join(desktopDirectory, 'src-tauri', 'binaries');
const pnpmWrapper = path.join(scriptDirectory, 'run-pnpm.ps1');

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 */
function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: workspaceDirectory,
    stdio: 'inherit',
    ...options,
  });
}

/**
 * Ejecuta pnpm sin construir una cadena de shell con argumentos dinámicos.
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 */
function runPnpm(args, options = {}) {
  if (process.platform === 'win32') {
    run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        pnpmWrapper,
        ...args,
      ],
      options,
    );
    return;
  }
  run('pnpm', args, options);
}

/** @returns {string} */
function rustTargetTriple() {
  const configuredTriple = process.env.ORIVUE_TARGET_TRIPLE?.trim();
  if (configuredTriple) {
    if (!/^[a-z0-9_]+(?:-[a-z0-9_]+){2,4}$/.test(configuredTriple)) {
      throw new Error('ORIVUE_TARGET_TRIPLE no tiene un formato válido');
    }
    return configuredTriple;
  }

  return execFileSync('rustc', ['--print', 'host-tuple'], {
    cwd: workspaceDirectory,
    encoding: 'utf8',
  }).trim();
}

/**
 * @param {string} triple
 * @returns {string}
 */
function pkgTargetFor(triple) {
  const architecture = triple.startsWith('aarch64-') ? 'arm64' : 'x64';

  if (triple.includes('windows')) return `node22-win-${architecture}`;
  if (triple.includes('apple-darwin')) return `node22-macos-${architecture}`;
  if (triple.includes('linux')) return `node22-linux-${architecture}`;

  throw new Error(`Target triple no soportado por el empaquetado inicial: ${triple}`);
}

runPnpm(['--filter', '@orivue/server', 'build']);

const triple = rustTargetTriple();
const extension = triple.includes('windows') ? '.exe' : '';
const output = path.join(binaryDirectory, `orivue-service-${triple}${extension}`);

mkdirSync(binaryDirectory, { recursive: true });
runPnpm(
  [
    '--filter',
    '@orivue/desktop',
    'exec',
    'pkg',
    serverEntry,
    '--targets',
    pkgTargetFor(triple),
    '--output',
    output,
    '--compress',
    'GZip',
  ],
  { cwd: desktopDirectory },
);

process.stdout.write(`Sidecar preparado para ${triple}\n`);

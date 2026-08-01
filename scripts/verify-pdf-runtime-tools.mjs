import { spawnSync } from 'node:child_process';

const checks = [
  ['qpdf', ['--version']],
  ['pdftoppm', ['-v']],
];

const mode = process.env.PDF_RUNTIME_TOOLS_MODE ?? 'docker';
if (mode === 'docker') {
  const image = process.env.PDF_RUNTIME_TOOLS_IMAGE ?? 'kaoyan408-import-test';
  const result = spawnSync('docker', ['run', '--rm', image, 'sh', '-lc', 'qpdf --version && pdftoppm -v'], { encoding: 'utf8', shell: false, windowsHide: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker runtime PDF tool check exited with status ${result.status ?? 'unknown'}`);
  process.exit(0);
}

if (mode !== 'local') throw new Error('PDF_RUNTIME_TOOLS_MODE must be "docker" or "local"');

for (const [command, args] of checks) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, windowsHide: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
}

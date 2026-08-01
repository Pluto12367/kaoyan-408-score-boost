import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { PdfDocumentService } from '../apps/api/dist/questions/import/pdf-document.service.js';
import { PdfPageRenderer } from '../apps/api/dist/questions/import/pdf-page-renderer.js';

const checks = [
  ['qpdf', ['--version']],
  ['pdftoppm', ['-v']],
];

const mode = process.env.PDF_RUNTIME_TOOLS_MODE ?? 'docker';
if (mode === 'docker') {
  const image = process.env.PDF_RUNTIME_TOOLS_IMAGE ?? 'kaoyan408-import-test';
  const result = spawnSync('docker', ['run', '--rm', '-e', 'PDF_RUNTIME_TOOLS_MODE=local', image, 'node', 'scripts/verify-pdf-runtime-tools.mjs'], { encoding: 'utf8', shell: false, windowsHide: true });
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

const directory = await mkdtemp(join(tmpdir(), 'pdf-runtime-tools-'));
const sourcePath = join(directory, 'generated.pdf');
try {
  const generated = await PDFDocument.create();
  for (let page = 1; page <= 3; page += 1) generated.addPage([100 + page, 200 + page]);
  await writeFile(sourcePath, await generated.save());
  const storage = {
    resolveTemporaryPdfPath: async () => sourcePath,
    registerProviderSplitArtifact: async () => undefined,
  };
  const pdf = new PdfDocumentService(storage);
  if (await pdf.pageCount('temporary/generated') !== 3) throw new Error('qpdf generated-PDF page count check failed');
  const [split] = await pdf.split('temporary/generated', [{ pageStart: 2, pageEnd: 3 }]);
  const splitId = split.storageKey.slice('provider-split/'.length);
  const splitPdf = await PDFDocument.load(await readFile(join(directory, 'provider-splits', `${splitId}.pdf`)));
  if (splitPdf.getPageCount() !== 2) throw new Error('qpdf generated-PDF split check failed');
  const preview = await new PdfPageRenderer(storage).render('temporary/generated', 2);
  const previewId = preview.storageKey.slice('page-preview/'.length);
  const jpeg = await readFile(join(directory, 'page-previews', `${previewId}.jpg`));
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) throw new Error('Poppler generated-PDF render check failed');
  process.stdout.write('generated PDF split/render verification passed\n');
} finally {
  await rm(directory, { recursive: true, force: true });
}

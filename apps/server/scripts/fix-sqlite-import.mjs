import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../dist/index.js', import.meta.url);
const source = await readFile(path, 'utf8');
const fixed = source.replace(/from ["']sqlite["']/g, 'from "node:sqlite"');
if (fixed === source || !fixed.includes('from "node:sqlite"')) {
  throw new Error('Bundled server did not contain the expected SQLite import');
}
await writeFile(path, fixed, 'utf8');

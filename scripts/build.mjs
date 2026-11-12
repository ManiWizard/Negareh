// Owns dist output; preserve identical bytes/mtimes so Cargo only re-embeds changed assets.
import { build } from 'vite';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const result = await build({ root, build: { write: false } });
if (Array.isArray(result) || !('output' in result)) throw new Error('Expected a single frontend bundle.');
const outputs = new Set();
await mkdir(dist, { recursive: true });

for (const entry of result.output) {
  const path = resolve(dist, entry.fileName);
  if (!path.startsWith(dist + sep)) throw new Error('Refusing output outside dist.');
  outputs.add(path);
  const bytes = Buffer.from('code' in entry ? entry.code : entry.source);
  let previous;
  try { previous = await readFile(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.equals(bytes)) continue;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function removeStale(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (!path.startsWith(dist + sep)) throw new Error('Refusing cleanup outside dist.');
    if (entry.isDirectory()) await removeStale(path);
    else if (!outputs.has(path)) await unlink(path);
  }
}

await removeStale(dist);

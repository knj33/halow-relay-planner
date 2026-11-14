// Package inspectable companion sources without external archive utilities.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'public', 'engine');
await mkdir(out, { recursive: true });
for (const name of ['relay-engine.c', 'Makefile']) {
  await copyFile(join(root, 'native', name), join(out, name));
}

async function bundle(target, entries) {
  const blocks = [];
  for (const [name, path] of entries) {
    const data = await readFile(join(root, path));
    const header = Buffer.alloc(512);
    const octal = (value, at, width) => header.write(value.toString(8).padStart(width - 1, '0') + '\0', at, width, 'ascii');
    header.write(name, 0, 100, 'utf8');
    octal(0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(data.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48; // regular file
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  await writeFile(join(out, target), gzipSync(Buffer.concat(blocks)));
}
await bundle('relay-engine-source.tar.gz', ['relay-engine.c', 'Makefile', 'test-engine.c', 'relay-engine.service'].map((name) => [name, `native/${name}`]));
const extFiles = ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js', 'README.md'];
await bundle('relay-engine-extension.tar.gz', ['chromium', 'firefox'].flatMap((browser) => extFiles.map((name) => [`extensions/${browser}/${name}`, `extensions/${browser}/${name}`])));
console.log('Synced engine sources and download bundles to public/engine/.');

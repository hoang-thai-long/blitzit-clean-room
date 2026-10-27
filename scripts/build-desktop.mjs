import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

await mkdir('desktop-dist', { recursive: true });
await mkdir('build', { recursive: true });
// Original, generated icon. No application assets are copied.
const crc32 = bytes => { let crc = -1; for (const b of bytes) { crc ^= b; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; };
const chunk = (name, data) => { const tag = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tag, data]))); return Buffer.concat([length, tag, data, crc]); };
const size = 512, raw = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const p = y * (size * 4 + 1) + 1 + x * 4;
  const leaf = ((x - 260) / 135) ** 2 + ((y - 235 + (x - 260) * .45) / 100) ** 2 < 1;
  const stem = Math.abs(y - (450 - x * .65)) < 10 && x > 140 && x < 365;
  const border = Math.max(Math.abs(x - 256), Math.abs(y - 256)) < 245;
  const color = leaf && !stem ? [165, 237, 181] : [22, 35, 26];
  raw[p] = color[0]; raw[p + 1] = color[1]; raw[p + 2] = color[2]; raw[p + 3] = border ? 255 : 0;
}
const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const icon = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
await writeFile('build/icon.png', icon); await writeFile('desktop-dist/icon.png', icon);
await build({ entryPoints: ['desktop/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'pg', 'pg-native'], outfile: 'desktop-dist/main.cjs' });
await build({ entryPoints: ['desktop/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], outfile: 'desktop-dist/preload.cjs' });

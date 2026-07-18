import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

const count = Number(process.argv[2] ?? 10_000);
const output = process.argv[3];
if (!Number.isInteger(count) || count < 1 || count > 250_000)
  throw new Error('Count must be between 1 and 250000');
if (!output) throw new Error('Usage: node scripts/generate-large-m3u.mjs <count> <output>');
const stream = createWriteStream(output, { encoding: 'utf8' });
stream.write('#EXTM3U\n');
for (let index = 0; index < count; index += 1) {
  const group = `Group ${String(index % 100).padStart(3, '0')}`;
  const id = `fixture.${String(index).padStart(6, '0')}`;
  if (
    !stream.write(
      `#EXTINF:-1 tvg-id="${id}" group-title="${group}",Fixture ${index}\nhttps://example.invalid/live/${id}.m3u8\n`,
    )
  )
    await once(stream, 'drain');
}
stream.end();
await once(stream, 'finish');
process.stdout.write(`Generated ${count} synthetic channels in ${output}\n`);

import { describe, expect, it } from 'vitest';
import { parseXmltv, parseXmltvDate } from '../src/index.js';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv [ <!ENTITY unsafe SYSTEM "file:///etc/passwd"> ]>
<tv>
  <channel id="café"><display-name lang="es">Café &amp; Noticias</display-name><display-name>日本</display-name><icon src="https://img.invalid/cafe.png" /></channel>
  <programme start="20260718120000 +0200" stop="20260718130000 +0200" channel="café">
    <title lang="es">Noticias &lt;mediodía&gt;</title><desc><![CDATA[Resumen propio]]></desc><category>Noticias</category>
  </programme>
</tv>`;

describe('parseXmltv', () => {
  it('parses channels, programmes, entities and explicit time zones', () => {
    const result = parseXmltv(FIXTURE);
    expect(result.warnings).toEqual([]);
    expect(result.channels[0]).toEqual({
      id: 'café',
      displayNames: ['Café & Noticias', '日本'],
      icon: 'https://img.invalid/cafe.png',
    });
    expect(result.programmes[0]).toMatchObject({
      channelId: 'café',
      title: 'Noticias <mediodía>',
      description: 'Resumen propio',
      category: 'Noticias',
      start: new Date('2026-07-18T10:00:00.000Z'),
      stop: new Date('2026-07-18T11:00:00.000Z'),
    });
  });

  it('parses across byte chunk boundaries without expanding custom entities', async () => {
    const bytes = new TextEncoder().encode(FIXTURE.replace('Noticias', 'Noticiás'));
    async function* chunks(): AsyncGenerator<Uint8Array> {
      await Promise.resolve();
      for (let index = 0; index < bytes.length; index += 7) yield bytes.slice(index, index + 7);
    }
    const result = await parseXmltv(chunks());
    expect(result.channels[0]?.displayNames[0]).toBe('Café & Noticiás');
    expect(JSON.stringify(result)).not.toContain('/etc/passwd');
  });

  it('skips malformed records and keeps valid records', () => {
    const result = parseXmltv(`<tv>
      <channel><display-name>No id</display-name></channel>
      <programme start="bad" channel="x"><title>Bad date</title></programme>
      <programme start="20260230120000 +0000" channel="x"><title>Impossible date</title></programme>
      <programme start="20260718120000 -0500" channel="x"><title>Valid</title></programme>
      <programme start="20260718130000 +0000" channel="x"></programme>
    </tv>`);
    expect(result.programmes).toHaveLength(1);
    expect(result.programmes[0]?.start.toISOString()).toBe('2026-07-18T17:00:00.000Z');
    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(['missing-attribute', 'invalid-date', 'missing-title']),
    );
  });

  it('treats timestamps without an offset as UTC consistently', () => {
    expect(parseXmltvDate('20260718120000')?.toISOString()).toBe('2026-07-18T12:00:00.000Z');
    expect(parseXmltvDate('20260718120000 -0330')?.toISOString()).toBe('2026-07-18T15:30:00.000Z');
  });

  it('parses a large streamed guide', async () => {
    const records = Array.from(
      { length: 10_000 },
      (_, index) =>
        `<programme start="20260718120000 +0000" channel="c${index}"><title>Programme ${index}</title></programme>`,
    );
    async function* source(): AsyncGenerator<string> {
      await Promise.resolve();
      yield '<tv>';
      for (const record of records) yield record;
      yield '</tv>';
    }
    const result = await parseXmltv(source());
    expect(result.programmes).toHaveLength(10_000);
  }, 15_000);
});

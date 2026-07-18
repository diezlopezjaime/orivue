import { afterEach, describe, expect, it } from 'vitest';
import { OrivueDatabase } from './database.js';

let db: OrivueDatabase | undefined;
afterEach(() => db?.close());
describe('transactional playlist updates', () => {
  it('preserves favourites by stable channel id', () => {
    db = new OrivueDatabase(':memory:');
    db.createPlaylist({ id: 'p1', name: 'Demo', content: '#EXTM3U' });
    db.replaceChannels('p1', [{ id: 'stable', name: 'One', url: 'https://example.test/one.m3u8' }]);
    db.setFavorite('stable', true);
    db.replaceChannels('p1', [
      { id: 'stable', name: 'Renamed', url: 'https://example.test/new.m3u8' },
    ]);
    expect(db.getChannel('stable')).toMatchObject({ name: 'Renamed', favorite: true });
  });
  it('rolls back the complete channel replacement on failure', () => {
    db = new OrivueDatabase(':memory:');
    db.createPlaylist({ id: 'p1', name: 'Demo', content: '#EXTM3U' });
    db.replaceChannels('p1', [{ id: 'one', name: 'One', url: 'https://example.test' }]);
    expect(() =>
      db!.replaceChannels('p1', [
        { id: 'duplicate', name: 'A', url: 'https://a.test' },
        { id: 'duplicate', name: 'B', url: 'https://b.test' },
      ]),
    ).toThrow();
    expect(db.listChannels({}).items.map((c) => c.id)).toEqual(['one']);
  });
});

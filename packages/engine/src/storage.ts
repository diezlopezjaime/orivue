import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Program, StoredChannel } from './types.js';

interface ChannelRevision {
  sourceId: string;
  importedAt: string;
  channels: StoredChannel[];
}

interface EpgChannelRevision {
  sourceId: string;
  importedAt: string;
  /** Lowercased XMLTV channel id → first display name. */
  names: Record<string, string>;
}

interface OrivueSchema extends DBSchema {
  channelRevisions: { key: string; value: ChannelRevision };
  epgChannels: { key: string; value: EpgChannelRevision };
  programs: {
    key: string;
    value: Program;
    indexes: { byChannelStart: [string, string, string]; bySource: string };
  };
  sourceContent: { key: string; value: { sourceId: string; content: string } };
}

export interface EngineStorage {
  readChannels(sourceId: string): Promise<StoredChannel[]>;
  readAllChannels(): Promise<Map<string, StoredChannel[]>>;
  writeChannels(sourceId: string, channels: StoredChannel[]): Promise<void>;
  deleteSource(sourceId: string): Promise<void>;
  readSourceContent(sourceId: string): Promise<string | undefined>;
  writeSourceContent(sourceId: string, content: string): Promise<void>;
  readEpgNames(sourceId: string): Promise<Record<string, string>>;
  replaceEpg(sourceId: string, names: Record<string, string>, programs: Program[]): Promise<void>;
  programsBetween(
    sourceId: string,
    epgKey: string,
    fromIso: string,
    toIso: string,
    limit?: number,
  ): Promise<Program[]>;
  currentAndNext(
    sourceId: string,
    epgKey: string,
    nowIso: string,
  ): Promise<{ current: Program | null; next: Program | null }>;
  purgeBefore(iso: string): Promise<number>;
  close(): void;
}

const DB_VERSION = 1;

export async function openEngineStorage(name = 'orivue'): Promise<EngineStorage> {
  const db = await openDB<OrivueSchema>(name, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('channelRevisions', { keyPath: 'sourceId' });
      database.createObjectStore('epgChannels', { keyPath: 'sourceId' });
      const programs = database.createObjectStore('programs', { keyPath: 'id' });
      programs.createIndex('byChannelStart', ['sourceId', 'epgKey', 'startAt']);
      programs.createIndex('bySource', 'sourceId');
      database.createObjectStore('sourceContent', { keyPath: 'sourceId' });
    },
  });
  return new IndexedDbStorage(db);
}

class IndexedDbStorage implements EngineStorage {
  constructor(private readonly db: IDBPDatabase<OrivueSchema>) {}

  async readChannels(sourceId: string): Promise<StoredChannel[]> {
    return (await this.db.get('channelRevisions', sourceId))?.channels ?? [];
  }

  async readAllChannels(): Promise<Map<string, StoredChannel[]>> {
    const revisions = await this.db.getAll('channelRevisions');
    return new Map(revisions.map((revision) => [revision.sourceId, revision.channels]));
  }

  async writeChannels(sourceId: string, channels: StoredChannel[]): Promise<void> {
    await this.db.put('channelRevisions', {
      sourceId,
      importedAt: new Date().toISOString(),
      channels,
    });
  }

  async deleteSource(sourceId: string): Promise<void> {
    const tx = this.db.transaction(
      ['channelRevisions', 'epgChannels', 'programs', 'sourceContent'],
      'readwrite',
    );
    await Promise.all([
      tx.objectStore('channelRevisions').delete(sourceId),
      tx.objectStore('epgChannels').delete(sourceId),
      tx.objectStore('sourceContent').delete(sourceId),
      deleteBySource(tx.objectStore('programs'), sourceId),
    ]);
    await tx.done;
  }

  async readSourceContent(sourceId: string): Promise<string | undefined> {
    return (await this.db.get('sourceContent', sourceId))?.content;
  }

  async writeSourceContent(sourceId: string, content: string): Promise<void> {
    await this.db.put('sourceContent', { sourceId, content });
  }

  async readEpgNames(sourceId: string): Promise<Record<string, string>> {
    return (await this.db.get('epgChannels', sourceId))?.names ?? {};
  }

  async replaceEpg(
    sourceId: string,
    names: Record<string, string>,
    programs: Program[],
  ): Promise<void> {
    const tx = this.db.transaction(['epgChannels', 'programs'], 'readwrite');
    const store = tx.objectStore('programs');
    await deleteBySource(store, sourceId);
    for (const program of programs) void store.put(program);
    void tx
      .objectStore('epgChannels')
      .put({ sourceId, importedAt: new Date().toISOString(), names });
    await tx.done;
  }

  async programsBetween(
    sourceId: string,
    epgKey: string,
    fromIso: string,
    toIso: string,
    limit = 500,
  ): Promise<Program[]> {
    const index = this.db.transaction('programs').store.index('byChannelStart');
    // Programmes that started up to 12 hours before the window may still overlap it.
    const earliest = new Date(Date.parse(fromIso) - 12 * 3_600_000).toISOString();
    const range = IDBKeyRange.bound(
      [sourceId, epgKey, earliest],
      [sourceId, epgKey, toIso],
      false,
      true,
    );
    const result: Program[] = [];
    let cursor = await index.openCursor(range);
    while (cursor && result.length < limit) {
      if (cursor.value.stopAt > fromIso) result.push(cursor.value);
      cursor = await cursor.continue();
    }
    return result;
  }

  async currentAndNext(
    sourceId: string,
    epgKey: string,
    nowIso: string,
  ): Promise<{ current: Program | null; next: Program | null }> {
    const index = this.db.transaction('programs').store.index('byChannelStart');
    const before = IDBKeyRange.bound([sourceId, epgKey, ''], [sourceId, epgKey, nowIso]);
    const after = IDBKeyRange.bound(
      [sourceId, epgKey, nowIso],
      [sourceId, epgKey, '￿'],
      true,
      false,
    );
    const [previous, upcoming] = await Promise.all([
      index.openCursor(before, 'prev'),
      index.openCursor(after, 'next'),
    ]);
    const current = previous && previous.value.stopAt > nowIso ? previous.value : null;
    return { current, next: upcoming?.value ?? null };
  }

  async purgeBefore(iso: string): Promise<number> {
    const tx = this.db.transaction('programs', 'readwrite');
    let removed = 0;
    let cursor = await tx.store.openCursor();
    while (cursor) {
      if (cursor.value.stopAt < iso) {
        void cursor.delete();
        removed += 1;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return removed;
  }

  close(): void {
    this.db.close();
  }
}

async function deleteBySource(
  store: {
    index(name: 'bySource'): {
      openKeyCursor(
        range: IDBKeyRange,
      ): Promise<{ primaryKey: string; continue(): Promise<unknown> } | null>;
    };
    delete(key: string): Promise<void>;
  },
  sourceId: string,
): Promise<void> {
  let cursor = await store.index('bySource').openKeyCursor(IDBKeyRange.only(sourceId));
  while (cursor) {
    void store.delete(cursor.primaryKey);
    cursor = (await cursor.continue()) as typeof cursor;
  }
}

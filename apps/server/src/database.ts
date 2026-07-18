import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.js';
import type { ChannelRecord, PlaylistRecord, ProgramRecord } from './types.js';

type SqlValue = string | number | bigint | null | Uint8Array;

interface PlaylistRow {
  id: string;
  name: string;
  url: string | null;
  epg_url: string | null;
  auto_refresh_minutes: number;
  status: 'pending' | 'ready' | 'error';
  last_updated_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  channel_count: number;
}

export class OrivueDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;',
    );
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    const existing = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
        (row) => row.version,
      ),
    );
    for (const migration of migrations) {
      if (existing.has(migration.version)) continue;
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.db
          .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      });
    }
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createPlaylist(input: {
    id: string;
    name: string;
    url?: string | undefined;
    epgUrl?: string | undefined;
    content?: string | undefined;
    autoRefreshMinutes?: number | undefined;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO playlists(id,name,url,epg_url,inline_content,auto_refresh_minutes,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?, 'pending',?,?)`,
      )
      .run(
        input.id,
        input.name,
        input.url ?? null,
        input.epgUrl ?? null,
        input.content ?? null,
        input.autoRefreshMinutes ?? 0,
        now,
        now,
      );
  }

  listPlaylists(): PlaylistRecord[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, COUNT(c.id) channel_count FROM playlists p
      LEFT JOIN channels c ON c.playlist_id=p.id GROUP BY p.id ORDER BY p.created_at DESC`,
      )
      .all() as unknown as PlaylistRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      epgUrl: row.epg_url,
      autoRefreshMinutes: row.auto_refresh_minutes,
      status: row.status,
      lastUpdatedAt: row.last_updated_at,
      lastError: row.last_error,
      channelCount: row.channel_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getPlaylist(id: string): (PlaylistRecord & { inlineContent: string | null }) | null {
    const row = this.db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM channels c WHERE c.playlist_id=p.id) channel_count
      FROM playlists p WHERE p.id=?`,
      )
      .get(id) as unknown as (PlaylistRow & { inline_content: string | null }) | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      epgUrl: row.epg_url,
      inlineContent: row.inline_content,
      autoRefreshMinutes: row.auto_refresh_minutes,
      status: row.status,
      lastUpdatedAt: row.last_updated_at,
      lastError: row.last_error,
      channelCount: row.channel_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updatePlaylist(
    id: string,
    patch: {
      name?: string | undefined;
      url?: string | null | undefined;
      epgUrl?: string | null | undefined;
      autoRefreshMinutes?: number | undefined;
    },
  ): boolean {
    const current = this.getPlaylist(id);
    if (!current) return false;
    this.db
      .prepare(
        `UPDATE playlists SET name=?,url=?,epg_url=?,auto_refresh_minutes=?,updated_at=? WHERE id=?`,
      )
      .run(
        patch.name ?? current.name,
        patch.url === undefined ? current.url : patch.url,
        patch.epgUrl === undefined ? current.epgUrl : patch.epgUrl,
        patch.autoRefreshMinutes ?? current.autoRefreshMinutes,
        new Date().toISOString(),
        id,
      );
    return true;
  }

  deletePlaylist(id: string): boolean {
    return this.db.prepare('DELETE FROM playlists WHERE id=?').run(id).changes > 0;
  }

  replaceChannels(
    playlistId: string,
    channels: Array<{
      id: string;
      name: string;
      url: string;
      groupName?: string | null;
      tvgId?: string | null;
      logo?: string | null;
      headers?: Record<string, string>;
    }>,
  ): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      const oldPreferences = new Map(
        (
          this.db
            .prepare(
              `SELECT c.id,c.hidden,c.custom_name,CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END favorite,
          r.played_at,r.play_count FROM channels c LEFT JOIN favorites f ON f.channel_id=c.id
          LEFT JOIN recents r ON r.channel_id=c.id WHERE c.playlist_id=?`,
            )
            .all(playlistId) as unknown as Array<{
            id: string;
            hidden: number;
            custom_name: string | null;
            favorite: number;
            played_at: string | null;
            play_count: number | null;
          }>
        ).map((row) => [row.id, row]),
      );
      this.db.prepare('DELETE FROM channels WHERE playlist_id=?').run(playlistId);
      this.db.prepare('DELETE FROM groups WHERE playlist_id=?').run(playlistId);
      const insertGroup = this.db.prepare(
        'INSERT OR IGNORE INTO groups(id,playlist_id,name,sort_order) VALUES(?,?,?,?)',
      );
      const insertChannel = this.db
        .prepare(`INSERT INTO channels(id,playlist_id,group_id,tvg_id,name,logo,stream_url,headers_json,hidden,custom_name,sort_order,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
      let order = 0;
      for (const channel of channels) {
        const groupName = channel.groupName?.trim() || 'Uncategorised';
        const groupId = `${playlistId}:${Buffer.from(groupName).toString('base64url').slice(0, 32)}`;
        insertGroup.run(groupId, playlistId, groupName, order);
        const preference = oldPreferences.get(channel.id);
        insertChannel.run(
          channel.id,
          playlistId,
          groupId,
          channel.tvgId ?? null,
          channel.name,
          channel.logo ?? null,
          channel.url,
          JSON.stringify(channel.headers ?? {}),
          preference?.hidden ?? 0,
          preference?.custom_name ?? null,
          order,
          now,
        );
        if (preference?.favorite)
          this.db
            .prepare('INSERT OR IGNORE INTO favorites(channel_id,created_at) VALUES(?,?)')
            .run(channel.id, now);
        if (preference?.played_at)
          this.db
            .prepare('INSERT OR IGNORE INTO recents(channel_id,played_at,play_count) VALUES(?,?,?)')
            .run(channel.id, preference.played_at, preference.play_count ?? 1);
        order += 1;
      }
      this.db
        .prepare(
          `UPDATE playlists SET status='ready',last_updated_at=?,last_error=NULL,updated_at=? WHERE id=?`,
        )
        .run(now, now, playlistId);
    });
  }

  markPlaylistError(id: string, message: string): void {
    this.db
      .prepare(`UPDATE playlists SET status='error',last_error=?,updated_at=? WHERE id=?`)
      .run(message, new Date().toISOString(), id);
  }

  listGroups(playlistId?: string): Array<{
    id: string;
    playlistId: string;
    name: string;
    hidden: boolean;
    channelCount: number;
  }> {
    const where = playlistId ? 'WHERE g.playlist_id=?' : '';
    const rows = this.db
      .prepare(
        `SELECT g.id,g.playlist_id,g.name,g.hidden,COUNT(c.id) channel_count FROM groups g
      LEFT JOIN channels c ON c.group_id=g.id ${where} GROUP BY g.id ORDER BY g.sort_order,g.name`,
      )
      .all(...(playlistId ? [playlistId] : [])) as unknown as Array<{
      id: string;
      playlist_id: string;
      name: string;
      hidden: number;
      channel_count: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      playlistId: row.playlist_id,
      name: row.name,
      hidden: Boolean(row.hidden),
      channelCount: row.channel_count,
    }));
  }

  listChannels(filters: {
    playlistId?: string | undefined;
    groupId?: string | undefined;
    search?: string | undefined;
    favorite?: boolean | undefined;
    recent?: boolean | undefined;
    includeHidden?: boolean | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): { items: ChannelRecord[]; total: number } {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filters.playlistId) {
      clauses.push('c.playlist_id=?');
      params.push(filters.playlistId);
    }
    if (filters.groupId) {
      clauses.push('c.group_id=?');
      params.push(filters.groupId);
    }
    if (filters.search) {
      clauses.push("COALESCE(c.custom_name,c.name) LIKE ? ESCAPE '\\'");
      params.push(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
    }
    if (filters.favorite) clauses.push('f.channel_id IS NOT NULL');
    if (filters.recent) clauses.push('r.channel_id IS NOT NULL');
    if (!filters.includeHidden) clauses.push('c.hidden=0');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const joins =
      'LEFT JOIN groups g ON g.id=c.group_id LEFT JOIN favorites f ON f.channel_id=c.id LEFT JOIN recents r ON r.channel_id=c.id';
    const total = (
      this.db.prepare(`SELECT COUNT(*) count FROM channels c ${joins} ${where}`).get(...params) as {
        count: number;
      }
    ).count;
    const rows = this.db
      .prepare(
        `SELECT c.*,g.name group_name,CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END favorite,r.played_at
      FROM channels c ${joins} ${where} ORDER BY ${filters.recent ? 'r.played_at DESC,' : ''} c.sort_order LIMIT ? OFFSET ?`,
      )
      .all(...params, Math.min(filters.limit ?? 200, 500), filters.offset ?? 0) as unknown as Array<
      Record<string, unknown>
    >;
    return { items: rows.map((row) => this.mapChannel(row)), total };
  }

  getChannel(id: string): ChannelRecord | null {
    const row = this.db
      .prepare(
        `SELECT c.*,g.name group_name,CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END favorite,r.played_at
      FROM channels c LEFT JOIN groups g ON g.id=c.group_id LEFT JOIN favorites f ON f.channel_id=c.id
      LEFT JOIN recents r ON r.channel_id=c.id WHERE c.id=?`,
      )
      .get(id) as unknown as Record<string, unknown> | undefined;
    return row ? this.mapChannel(row) : null;
  }

  private mapChannel(row: Record<string, unknown>): ChannelRecord {
    return {
      id: String(row.id),
      playlistId: String(row.playlist_id),
      groupId: typeof row.group_id === 'string' ? row.group_id : null,
      groupName: typeof row.group_name === 'string' ? row.group_name : null,
      tvgId: typeof row.tvg_id === 'string' ? row.tvg_id : null,
      name: String(row.custom_name ?? row.name),
      logo: typeof row.logo === 'string' ? row.logo : null,
      streamUrl: String(row.stream_url),
      headers: JSON.parse(String(row.headers_json)) as Record<string, string>,
      hidden: Boolean(row.hidden),
      favorite: Boolean(row.favorite),
      lastPlayedAt: typeof row.played_at === 'string' ? row.played_at : null,
    };
  }

  updateChannel(
    id: string,
    patch: {
      hidden?: boolean | undefined;
      name?: string | null | undefined;
      groupId?: string | null | undefined;
    },
  ): boolean {
    const current = this.getChannel(id);
    if (!current) return false;
    return (
      this.db
        .prepare('UPDATE channels SET hidden=?,custom_name=?,group_id=?,updated_at=? WHERE id=?')
        .run(
          patch.hidden === undefined ? Number(current.hidden) : Number(patch.hidden),
          patch.name === undefined ? null : patch.name,
          patch.groupId === undefined ? current.groupId : patch.groupId,
          new Date().toISOString(),
          id,
        ).changes > 0
    );
  }

  setGroupHidden(id: string, hidden: boolean): boolean {
    return (
      this.db.prepare('UPDATE groups SET hidden=? WHERE id=?').run(Number(hidden), id).changes > 0
    );
  }

  setFavorite(channelId: string, value: boolean): boolean {
    if (!this.getChannel(channelId)) return false;
    if (value)
      this.db
        .prepare('INSERT OR IGNORE INTO favorites(channel_id,created_at) VALUES(?,?)')
        .run(channelId, new Date().toISOString());
    else this.db.prepare('DELETE FROM favorites WHERE channel_id=?').run(channelId);
    return true;
  }

  markRecent(channelId: string): void {
    this.db
      .prepare(
        `INSERT INTO recents(channel_id,played_at,play_count) VALUES(?,?,1)
      ON CONFLICT(channel_id) DO UPDATE SET played_at=excluded.played_at,play_count=play_count+1`,
      )
      .run(channelId, new Date().toISOString());
  }

  replaceEpg(
    playlistId: string,
    sourceUrl: string,
    channels: Array<{ id: string; displayName: string }>,
    programs: ProgramRecord[],
  ): void {
    const sourceId = `epg:${playlistId}`;
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO epg_sources(id,playlist_id,url,status,last_updated_at) VALUES(?,?,?,'ready',?)
        ON CONFLICT(playlist_id) DO UPDATE SET url=excluded.url,status='ready',last_updated_at=excluded.last_updated_at,last_error=NULL`,
        )
        .run(sourceId, playlistId, sourceUrl, now);
      this.db.prepare('DELETE FROM epg_channels WHERE source_id=?').run(sourceId);
      const addChannel = this.db.prepare(
        'INSERT INTO epg_channels(id,source_id,display_name) VALUES(?,?,?)',
      );
      for (const channel of channels) addChannel.run(channel.id, sourceId, channel.displayName);
      const addProgram = this.db.prepare(
        'INSERT INTO programs(id,epg_channel_id,title,description,start_at,stop_at) VALUES(?,?,?,?,?,?)',
      );
      for (const program of programs)
        addProgram.run(
          program.id,
          program.epgChannelId,
          program.title,
          program.description,
          program.startAt,
          program.stopAt,
        );
      this.db
        .prepare(
          `INSERT OR IGNORE INTO channel_epg_map(channel_id,epg_channel_id,manual)
        SELECT c.id,e.id,0 FROM channels c JOIN epg_channels e ON e.source_id=? AND (
          (c.tvg_id IS NOT NULL AND lower(c.tvg_id)=lower(e.id)) OR lower(COALESCE(c.custom_name,c.name))=lower(e.display_name))
        WHERE c.playlist_id=?`,
        )
        .run(sourceId, playlistId);
      this.db.prepare("DELETE FROM programs WHERE stop_at < datetime('now','-24 hours')").run();
    });
  }

  epgNow(
    channelIds?: string[],
  ): Array<{ channelId: string; current: ProgramRecord | null; next: ProgramRecord | null }> {
    const channels = channelIds?.length
      ? channelIds
      : (
          this.db.prepare('SELECT id FROM channels WHERE hidden=0 LIMIT 500').all() as {
            id: string;
          }[]
        ).map((r) => r.id);
    const result = [];
    const now = new Date().toISOString();
    const currentStmt = this.db
      .prepare(`SELECT p.* FROM channel_epg_map m JOIN programs p ON p.epg_channel_id=m.epg_channel_id
      WHERE m.channel_id=? AND p.start_at<=? AND p.stop_at>? ORDER BY p.start_at DESC LIMIT 1`);
    const nextStmt = this.db
      .prepare(`SELECT p.* FROM channel_epg_map m JOIN programs p ON p.epg_channel_id=m.epg_channel_id
      WHERE m.channel_id=? AND p.start_at>? ORDER BY p.start_at LIMIT 1`);
    for (const channelId of channels)
      result.push({
        channelId,
        current: this.mapProgram(currentStmt.get(channelId, now, now)),
        next: this.mapProgram(nextStmt.get(channelId, now)),
      });
    return result;
  }

  timeline(
    from: string,
    to: string,
    channelIds?: string[],
  ): Array<{ channelId: string; programs: ProgramRecord[] }> {
    const clauses = ['p.stop_at>?', 'p.start_at<?'];
    const params: SqlValue[] = [from, to];
    if (channelIds?.length) {
      clauses.push(`m.channel_id IN (${channelIds.map(() => '?').join(',')})`);
      params.push(...channelIds);
    }
    const rows = this.db
      .prepare(
        `SELECT m.channel_id,p.* FROM channel_epg_map m JOIN programs p ON p.epg_channel_id=m.epg_channel_id
      WHERE ${clauses.join(' AND ')} ORDER BY m.channel_id,p.start_at LIMIT 10000`,
      )
      .all(...params) as unknown as Array<Record<string, unknown>>;
    const grouped = new Map<string, ProgramRecord[]>();
    for (const row of rows) {
      const id = String(row.channel_id);
      const program = this.mapProgram(row);
      if (program) (grouped.get(id) ?? (grouped.set(id, []), grouped.get(id)!)).push(program);
    }
    return [...grouped].map(([channelId, programs]) => ({ channelId, programs }));
  }

  mapEpg(channelId: string, epgChannelId: string): boolean {
    if (!this.getChannel(channelId)) return false;
    this.db
      .prepare(
        `INSERT INTO channel_epg_map(channel_id,epg_channel_id,manual) VALUES(?,?,1)
      ON CONFLICT(channel_id) DO UPDATE SET epg_channel_id=excluded.epg_channel_id,manual=1`,
      )
      .run(channelId, epgChannelId);
    return true;
  }

  private mapProgram(row: unknown): ProgramRecord | null {
    if (!row) return null;
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      epgChannelId: String(r.epg_channel_id),
      title: String(r.title),
      description: typeof r.description === 'string' ? r.description : null,
      startAt: String(r.start_at),
      stopAt: String(r.stop_at),
    };
  }
}

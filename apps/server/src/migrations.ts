export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT,
        epg_url TEXT,
        inline_content TEXT,
        auto_refresh_minutes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        last_updated_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(playlist_id, name)
      );
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
        tvg_id TEXT,
        name TEXT NOT NULL,
        logo TEXT,
        stream_url TEXT NOT NULL,
        headers_json TEXT NOT NULL DEFAULT '{}',
        hidden INTEGER NOT NULL DEFAULT 0,
        custom_name TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS favorites (
        channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recents (
        channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        played_at TEXT NOT NULL,
        play_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS epg_sources (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL UNIQUE REFERENCES playlists(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        last_updated_at TEXT,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS epg_channels (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES epg_sources(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS programs (
        id TEXT PRIMARY KEY,
        epg_channel_id TEXT NOT NULL REFERENCES epg_channels(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        start_at TEXT NOT NULL,
        stop_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_epg_map (
        channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        epg_channel_id TEXT NOT NULL REFERENCES epg_channels(id) ON DELETE CASCADE,
        manual INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS playback_sessions (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        resolver TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        stopped_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_channels_playlist_group ON channels(playlist_id, group_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_channels_tvg ON channels(tvg_id);
      CREATE INDEX IF NOT EXISTS idx_channels_name ON channels(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_programs_channel_time ON programs(epg_channel_id, start_at, stop_at);
      CREATE INDEX IF NOT EXISTS idx_recents_played ON recents(played_at DESC);
    `,
  },
] as const;

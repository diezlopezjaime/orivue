import { createHash, randomUUID } from 'node:crypto';
import { parseM3u } from '@orivue/m3u-parser';
import { parseXmltv } from '@orivue/xmltv-parser';
import type { OrivueDatabase } from './database.js';
import { publicError } from './redact.js';
import { limitedFetch, readLimitedText } from './security.js';

export interface ImportOptions {
  allowPrivateNetwork: boolean;
  maxPlaylistBytes?: number;
  maxEpgBytes?: number;
}

export async function refreshPlaylist(
  db: OrivueDatabase,
  playlistId: string,
  options: ImportOptions,
): Promise<{ channelCount: number; warnings: string[] }> {
  const playlist = db.getPlaylist(playlistId);
  if (!playlist) throw new Error('Playlist not found');
  try {
    let content = playlist.inlineContent;
    if (playlist.url) {
      content = await readLimitedText(
        await limitedFetch(playlist.url, {
          allowPrivateNetwork: options.allowPrivateNetwork,
          maxRedirects: 3,
          timeoutMs: 20_000,
        }),
        options.maxPlaylistBytes ?? 30 * 1024 * 1024,
      );
    }
    if (!content) throw new Error('Playlist has no source');
    const parsed = parseM3u(content, { sourceId: playlistId });
    const channels = parsed.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      url: channel.url,
      groupName: channel.groupName ?? null,
      tvgId: channel.tvgId ?? null,
      logo: channel.logo ?? null,
      headers: channel.headers ?? {},
    }));
    if (channels.length === 0)
      throw new Error('The playlist did not contain any playable channels');
    // replaceChannels is transactional: a failed parse never removes the previous version.
    db.replaceChannels(playlistId, channels);
    if (playlist.epgUrl) await refreshEpg(db, playlistId, playlist.epgUrl, options);
    return {
      channelCount: channels.length,
      warnings: parsed.warnings.map((warning) =>
        typeof warning === 'string' ? warning : warning.message,
      ),
    };
  } catch (error) {
    db.markPlaylistError(playlistId, publicError(error));
    throw error;
  }
}

export async function refreshEpg(
  db: OrivueDatabase,
  playlistId: string,
  url: string,
  options: ImportOptions,
): Promise<{ programCount: number; warnings: string[] }> {
  const content = await readLimitedText(
    await limitedFetch(url, {
      allowPrivateNetwork: options.allowPrivateNetwork,
      maxRedirects: 3,
      timeoutMs: 30_000,
    }),
    options.maxEpgBytes ?? 80 * 1024 * 1024,
  );
  const parsed = parseXmltv(content);
  const channels = parsed.channels.map((channel) => ({
    id: channel.id,
    displayName: channel.displayNames[0] ?? channel.id,
  }));
  const programs = parsed.programmes.map((program) => ({
    id: createHash('sha256')
      .update(`${program.channelId}\0${program.start.toISOString()}\0${program.title}`)
      .digest('base64url')
      .slice(0, 32),
    epgChannelId: program.channelId,
    title: program.title,
    description: program.description ?? null,
    startAt: program.start.toISOString(),
    stopAt: (program.stop ?? new Date(program.start.getTime() + 30 * 60_000)).toISOString(),
  }));
  db.replaceEpg(playlistId, url, channels, programs);
  return {
    programCount: programs.length,
    warnings: parsed.warnings.map((warning) =>
      typeof warning === 'string' ? warning : warning.message,
    ),
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

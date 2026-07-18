import { buildApp } from './app.js';
import { refreshPlaylist } from './importer.js';

const requestedHost = process.env.ORIVUE_HOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(requestedHost))
  throw new Error('ORIVUE_HOST must be a loopback address');
const port = Number(process.env.ORIVUE_PORT ?? 4310);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('ORIVUE_PORT is invalid');
const app = await buildApp({ logger: process.env.NODE_ENV !== 'test' });
const address = await app.listen({ host: requestedHost, port });
const actualPort = new URL(address).port;
process.stdout.write(
  `${JSON.stringify({ event: 'ready', host: requestedHost, port: Number(actualPort) })}\n`,
);
const refreshing = new Set<string>();
const refreshTimer = setInterval(() => {
  const now = Date.now();
  for (const playlist of app.orivueDb.listPlaylists()) {
    if (!playlist.autoRefreshMinutes || refreshing.has(playlist.id)) continue;
    const due =
      !playlist.lastUpdatedAt ||
      now - Date.parse(playlist.lastUpdatedAt) >= playlist.autoRefreshMinutes * 60_000;
    if (!due) continue;
    refreshing.add(playlist.id);
    void refreshPlaylist(app.orivueDb, playlist.id, {
      allowPrivateNetwork: process.env.ORIVUE_ALLOW_PRIVATE_NETWORK === '1',
    })
      .catch(() => undefined)
      .finally(() => refreshing.delete(playlist.id));
  }
}, 60_000);
refreshTimer.unref();
const shutdown = async () => {
  clearInterval(refreshTimer);
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});

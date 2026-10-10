# API del engine

Desde 0.2 no hay API HTTP local. La UI usa `@orivue/engine` en proceso. Los
tipos exactos están en `packages/engine/src/types.ts` y prevalecen sobre este
resumen.

## Plataforma

El engine recibe un `EnginePlatform`:

| Miembro                    | Navegador                      | Tauri                                              |
| -------------------------- | ------------------------------ | -------------------------------------------------- |
| `fetchText(url, opciones)` | `fetch` (CORS) o relay de Vite | comando `fetch_source` (Rust, límites y anti-SSRF) |
| `kv.get/set/delete`        | `localStorage`                 | comandos `kv_*` (archivos JSON en datos de la app) |

## Fuentes

| Método                                 | Función                                                 |
| -------------------------------------- | ------------------------------------------------------- |
| `listSources()` / `getSource(id)`      | Fuentes con URL y contraseña redactadas                 |
| `addSource({kind:'m3u'                 | 'xtream'                                                | 'file'})` | Crear; una URL `get.php` se convierte en fuente Xtream |
| `updateSource(id, patch)`              | Nombre, URL, guía, refresco, formato Xtream             |
| `removeSource(id)`                     | Borra canales, programas y contenido asociados          |
| `refreshSource(id)`                    | Descarga, parsea y sustituye la revisión; luego la guía |
| `refreshEpg(id)`                       | Solo la guía                                            |
| `validateXtream(host, usuario, clave)` | Consulta `player_api.php` sin crear la fuente           |
| `refreshDue()` / `startAutoRefresh()`  | Refresco automático por intervalo                       |

## Biblioteca y consultas

| Método                                                                                       | Función                                                           |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `listGroups(sourceId?)`                                                                      | Categorías con recuento y estado oculto                           |
| `listChannels(query)`                                                                        | Filtro por fuente, grupo, texto, favoritos, recientes, paginación |
| `getChannel(id)`                                                                             | Canal con número, favorito, oculto, tipo de stream                |
| `setFavorite`, `markRecent`, `setChannelHidden`, `setGroupHidden`, `renameChannel`, `mapEpg` | Personalización                                                   |

## Guía

| Método                               | Función                                     |
| ------------------------------------ | ------------------------------------------- |
| `epgNow(channelIds)`                 | Programa actual y siguiente con caché corta |
| `timeline(desde, hasta, channelIds)` | Programas que solapan la ventana            |
| `listEpgChannels(sourceId)`          | Canales XMLTV para asociación manual        |

## A la carta (Xtream)

| Método                                | Función                                                |
| ------------------------------------- | ------------------------------------------------------ |
| `listVodCategories(kind, sourceId?)`  | Categorías de películas o series con recuento          |
| `listVod({kind, categoryId, search})` | Títulos filtrados y paginados                          |
| `getSeriesInfo(id)`                   | Temporadas y episodios (`get_series_info`, caché 24 h) |
| `getPlayableVod(id, episodeId?)`      | Stream de una película o de un episodio                |

El catálogo se descarga en cada refresco de una fuente Xtream; si el panel no
lo expone, las entradas VOD del M3U se mantienen como canales.

## Reproducción

`getPlayable(channelId)` devuelve `{ title, live, url, kind, headers,
allowLoopback }` y marca el canal como reciente. `kind` es `hls`, `mpegts`, `http`, `acestream` o
`unknown`; el proxy lo afina con el `Content-Type` real.

## Comandos Tauri

| Comando                           | Función                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| `proxy_info`                      | Base URL y token del proxy loopback                          |
| `device_info`                     | Plataforma, versión, móvil, depuración                       |
| `fetch_source`                    | Descarga acotada de texto (listas, guías, JSON)              |
| `open_playback`                   | Abre sesión de proxy; devuelve URL loopback y `Content-Type` |
| `close_playback`                  | Cierra la sesión y cancela descargas                         |
| `kv_get` / `kv_set` / `kv_delete` | Almacén clave-valor durable                                  |
| `plugin:orivue-native             | *`                                                           | Reproductor nativo, botón atrás e info de dispositivo (móvil) |

## Errores

Los mensajes de error pasan por `safeError`: se redactan `username`, `password`,
`token`, cabeceras `Authorization` y las rutas Xtream `/live/usuario/clave/`.
Los listados nunca contienen la contraseña de una cuenta Xtream.

# Arquitectura

Orivue es una aplicación local-first en un monorepo pnpm. Desde 0.2 no existe
ningún servicio HTTP local: el dominio corre dentro de la webview y las
operaciones de red privilegiadas viven en el proceso Rust de Tauri. Un único
proyecto Tauri produce escritorio, Android, Fire TV e iOS.

## Componentes

| Ruta                                                       | Responsabilidad                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/web`                                                 | UI React/Vite, navegación TV, reproductor y adaptadores         |
| `apps/desktop/src-tauri`                                   | Shell Tauri 2: comandos, proxy y plugin nativo                  |
| `apps/desktop/src-tauri/crates/stream-proxy`               | Proxy loopback de streams (Rust, sin dependencia de Tauri)      |
| `apps/desktop/src-tauri/crates/tauri-plugin-orivue-native` | Media3 en Android/Fire TV, botón atrás, info de dispositivo     |
| `apps/desktop/src-tauri/gen/android`                       | Proyecto Gradle generado y versionado (banner Fire TV, firma)   |
| `packages/engine`                                          | Fuentes, importación, IndexedDB, biblioteca, EPG, reproducibles |
| `packages/xtream`                                          | Xtream Codes: detección, URLs, cuenta, redacción                |
| `packages/core`                                            | Entidades y utilidades sin infraestructura                      |
| `packages/m3u-parser`                                      | Lectura tolerante y acotada de M3U                              |
| `packages/xmltv-parser`                                    | Lectura incremental y normalización temporal XMLTV              |
| `packages/stream-resolvers`                                | Resolutores HLS, HTTP y Ace Stream opcional                     |
| `fixtures`                                                 | Datos sintéticos reproducibles y sin contenido protegido        |

## Flujo principal

1. La UI pide al engine añadir una fuente (URL, cuenta Xtream o archivo).
2. El engine construye la URL de lista y guía y la descarga a través de la
   plataforma: en Tauri el comando `fetch_source` (Rust) aplica límites de
   tamaño, tiempo y redirecciones y bloquea destinos privados; la guía XMLTV
   va por `fetch_epg`, que la descarga a disco y la lee en streaming
   devolviendo solo los programas del horizonte; en el navegador se usa
   `fetch` (CORS) o el relay de desarrollo de Vite.
3. El parser produce canales y avisos; la revisión se escribe de una vez en
   IndexedDB y solo sustituye a la anterior si es válida.
4. Favoritos, recientes, ocultos, nombres y asociaciones EPG se guardan en un
   documento clave-valor (archivo JSON en Tauri, `localStorage` en navegador).
5. Al reproducir, el engine devuelve la URL y cabeceras del canal. En Tauri,
   `open_playback` abre una sesión en el proxy loopback que valida el destino,
   lo sondea y devuelve una URL `http://127.0.0.1:<puerto>/s/<sesión>/<token>/r?u=…`.
6. El reproductor elige backend: Media3 nativo (Android/Fire TV, con la URL
   original), `mpegts.js`, `hls.js` o `<video>` según el tipo detectado y el
   `Content-Type` real.
7. Cambiar o cerrar un canal cierra la sesión y cancela las descargas.

## Persistencia

IndexedDB guarda una revisión de canales por fuente, los nombres de canales
XMLTV y los programas (índice `[fuente, canal, inicio]`) acotados por el
horizonte configurado. El almacén clave-valor guarda fuentes (con credenciales),
biblioteca y ajustes. En Tauri vive en el directorio de datos de la app; en
navegador, en el origen de la página.

## Reproducción por plataforma

Consulta [platforms.md](platforms.md). La decisión y sus consecuencias están en
[ADR-0006](adr/0006-portable-engine-and-rust-proxy.md); ADR-0005 (sidecar Node)
queda superado.

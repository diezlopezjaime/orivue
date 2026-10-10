# ADR-0006: núcleo portable en la webview y proxy de streams en Rust

- Estado: aceptado; sustituye a ADR-0005
- Fecha: 2026-10-10

## Contexto

Orivue debe funcionar en escritorio (Windows, macOS, Linux), Android, iOS y
Fire TV Stick. La arquitectura de `0.1.0` dependía de un servicio Node
(`apps/server`) empaquetado como sidecar: importaba listas, guardaba SQLite y
hacía de proxy de streams. Ese proceso no puede ejecutarse en Android, iOS ni
Fire OS, y el sidecar duplicaba además la lógica de seguridad en dos runtimes.

Las listas reales de tipo Xtream Codes devuelven MPEG-TS directo por HTTP
(`output=ts`), no HLS, así que el reproductor basado solo en `hls.js` no
reproducía nada aunque la importación funcionase. Los paneles tampoco envían
cabeceras CORS, por lo que una webview no puede descargar ni listas ni
segmentos sin un intermediario local.

## Decisión

1. **Un único proyecto Tauri 2** (`apps/desktop`, nombre histórico) genera las
   cuatro familias: escritorio, Android/Fire TV (`src-tauri/gen/android`,
   versionado) e iOS (`gen/apple`, generado en CI macOS porque la CLI de Linux
   no incluye `tauri ios`).
2. **El dominio vive en TypeScript portable** (`packages/engine`), sin APIs de
   Node: importación M3U/M3U8/m3u_plus, Xtream Codes (`packages/xtream`),
   XMLTV, favoritos, recientes, ocultos, búsqueda, EPG y refresco automático.
   Persistencia local-first en IndexedDB (canales, programas) y un almacén
   clave-valor pequeño para fuentes y preferencias. Se ejecuta tal cual en
   cualquier webview (WebView2, WebKitGTK, WKWebView, Android WebView) y en el
   navegador para desarrollo y pruebas e2e.
3. **Las operaciones de red privilegiadas se hacen en Rust** dentro del
   proceso Tauri, compartidas por todas las plataformas:
   - `fetch_source`: descarga listas y guías con límites de tamaño, tiempo y
     redirecciones y con bloqueo de destinos privados salvo opción explícita.
   - **Proxy de streams loopback** (`crates/stream-proxy`): servidor HTTP en
     `127.0.0.1` con puerto aleatorio y token por ejecución. Solo sirve URLs
     que pertenezcan a una sesión de reproducción abierta por la app, reenvía
     las cabeceras declaradas por la lista (`User-Agent`, `Referer`...) y
     transmite TS y HLS en streaming. Reemplaza al proxy Node.
4. **Reproducción por backends**, elegida en tiempo de ejecución:
   - Web (todas las plataformas): `mpegts.js` para MPEG-TS/FLV sobre MSE o
     ManagedMediaSource, `hls.js` para HLS donde no hay soporte nativo y el
     elemento `<video>` para HLS nativo (WebKit).
   - Android y Fire TV: plugin Tauri `orivue-native` con Media3/ExoPlayer
     detrás de una webview transparente. Si el plugin no está disponible, se
     usa el backend web.
   - iOS: WebKit reproduce HLS de forma nativa; TS pasa por `mpegts.js` con
     ManagedMediaSource (iOS 17.1+). No se integra VLCKit en esta versión; la
     interfaz de backends deja el hueco para hacerlo sin tocar la UI.
5. **Ace Stream** sigue siendo opcional: el resolutor contacta con un motor
   local (`127.0.0.1:6878`) a través del proxy Rust, que para este caso admite
   loopback.
6. `apps/server` y el empaquetado con `pkg` se eliminan. Las pruebas de
   seguridad de SSRF, redacción y límites se trasladan al engine y a Rust.

## Consecuencias

- Ya no hay API HTTP local: la UI llama al engine en proceso y a comandos
  Tauri. `docs/api.md` describe ahora la API del engine.
- La base de datos deja de ser SQLite; una importación sigue siendo atómica
  (la revisión anterior solo se sustituye si la nueva es válida).
- La compatibilidad de códecs en el backend web depende de MSE: H.264/AAC
  funciona; MPEG-2 vídeo, MP2 o AC-3 dentro de TS no se decodifican en la
  webview. En Android/Fire TV el backend nativo cubre esos casos.
- Android e iOS no pueden validarse en este entorno de desarrollo; CI compila
  los artefactos y el estado se declara como "no validado en dispositivo".

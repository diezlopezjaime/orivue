# Changelog

Todos los cambios notables se documentarán aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## 0.2.1

### Corregido

- Las cuentas Xtream Codes obtienen los canales en directo de la API
  (`get_live_streams`) en lugar de descargar la lista `get.php` completa, que
  incluye todo el catálogo a la carta y en proveedores grandes superaba el
  límite de tamaño ("the source exceeds the size limit"). La lista `get.php`
  queda como reserva, con el límite ampliado a 120 MB, y el error de tamaño
  ahora indica el límite.
- Los ids de canal son los mismos con ambos importadores, así que favoritos y
  nombres personalizados se conservan.
- Mis listas muestra en qué paso está una importación (cuenta, canales,
  catálogo, guía), los avisos de la última actualización y los errores de los
  botones de actualizar; los mensajes de límite de tamaño y de tiempo de espera
  indican el valor del límite.
- Una lista cuya primera importación no llegó a terminar (por ejemplo al cerrar
  la app a medias) se reintenta sola al arrancar aunque esté en "Manual".

## 0.2.0

### Añadido

- Catálogo a la carta de Xtream Codes: películas y series con temporadas y
  episodios desde `player_api.php`, página Vídeo, barra de progreso y teclas de
  avance/retroceso; las entradas VOD dejan de mezclarse con los canales.
- Gestión de la biblioteca desde la interfaz: renombrar, ocultar y asignar guía
  por canal, ocultar categorías, filtro de ocultos y "continuar viendo".
- Zapping por número con el mando o el teclado, último canal y tecla `R`.
- Inglés además de español, con detección automática y selector en Ajustes.
- Prueba de escala opcional del motor (`ORIVUE_PERF=1`) con 30 000 canales y
  guía de 7 días.
- Aplicación multiplataforma desde un único proyecto Tauri 2: escritorio
  (Linux, Windows, macOS), Android, Fire TV Stick e iOS (ADR-0006).
- `packages/engine`: motor portable con importación M3U/Xtream/archivo,
  IndexedDB, favoritos, recientes, ocultos, búsqueda, XMLTV (ahora/siguiente y
  línea temporal) y refresco automático.
- `packages/xtream`: detección de URLs Xtream Codes, constructores de
  `get.php`/`xmltv.php`/`player_api.php`, validación de cuenta y redacción.
- Proxy de streams en Rust (`crates/stream-proxy`) con token, orígenes por
  sesión, validación anti-SSRF, reescritura de manifiestos HLS y streaming TS.
- Reproductor con backends: `mpegts.js` para MPEG-TS, `hls.js`/HLS nativo,
  vídeo progresivo y Media3/ExoPlayer nativo en Android y Fire TV
  (`crates/tauri-plugin-orivue-native`).
- Página de ajustes (modo TV, motor de reproducción, red local, horizonte EPG),
  modo 10 pies, botón atrás del mando, diseño táctil.
- Workflows de CI para proxy Rust, instaladores de escritorio, APK de Android
  y app de simulador iOS; releases preliminares al etiquetar `v*`.

### Cambiado

- El parser M3U expone la URL de guía anunciada en `#EXTM3U url-tvg`.
- La UI consulta el motor en proceso en lugar de una API HTTP local.

### Eliminado

- `apps/server` (Fastify + SQLite) y el sidecar empaquetado con `pkg`.

### Pendiente de validar

- Android, Fire TV e iOS compilan en CI pero no se han ejecutado en un
  dispositivo real en este ciclo.
- La integración con un motor Ace Stream físico sigue sin probar.
- La lista Xtream de prueba privada no era alcanzable desde el entorno de
  desarrollo (política de red); la importación Xtream se validó con un panel
  simulado en tests unitarios y end-to-end.

## 0.1.0 - Sin publicar

Preversión inicial: monorepo, parser M3U, servicio Fastify loopback, web React
con navegación TV y configuración Tauri de escritorio.

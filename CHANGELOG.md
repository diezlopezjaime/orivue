# Changelog

Todos los cambios notables se documentarán aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## Unreleased (0.2.0)

### Añadido

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

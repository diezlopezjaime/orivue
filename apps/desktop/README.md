# Orivue para escritorio, Android, Fire TV e iOS (Tauri 2)

Shell nativo de la web. El nombre del directorio es histórico: desde 0.2 el
mismo proyecto genera todas las plataformas.

## Qué aporta la capa Rust

- `crates/stream-proxy`: proxy loopback con token que sirve MPEG-TS y HLS al
  reproductor web sin CORS, valida destinos y reescribe manifiestos.
- Comandos `fetch_source`, `open_playback`, `close_playback`, `kv_*`,
  `proxy_info` y `device_info` (`src/lib.rs`).
- `crates/tauri-plugin-orivue-native`: plugin móvil. En Android/Fire TV aloja
  un `PlayerView` de Media3 detrás de la webview transparente, intercepta el
  botón atrás y reporta si el dispositivo es una televisión. En iOS solo
  reporta información del dispositivo.

## Escritorio

Requiere Rust estable y los [prerrequisitos de Tauri 2](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm --filter @orivue/desktop desktop:dev
pnpm --filter @orivue/desktop desktop:build
pnpm --filter @orivue/desktop desktop:check
```

`cargo check` se ha ejecutado en Linux con WebKitGTK 4.1. Los bundles de
Windows y macOS solo se han generado en CI.

## Android y Fire TV

Requiere Android SDK (platform 36, build-tools 36), NDK 27, Java 17 y las
variables `ANDROID_HOME` y `NDK_HOME`.

```bash
pnpm --filter @orivue/desktop android:dev
pnpm --filter @orivue/desktop android:build
```

`src-tauri/gen/android` está versionado. Contiene el banner de Fire TV
(`res/drawable-xhdpi/banner.png`), `uses-feature touchscreen required=false`,
tráfico HTTP en claro permitido y una configuración de firma opcional que lee
`keystore.properties` (ver `.github/workflows/android.yml`). Sin keystore, la
APK de release queda sin firmar y CI publica también la APK de depuración, que
sí se puede instalar por sideload.

Instalación en Fire TV: activa ADB y aplicaciones de origen desconocido y
ejecuta `adb connect <ip>` seguido de `adb install -r orivue-universal-debug.apk`.
Consulta `docs/platforms.md`.

## iOS

Solo en macOS con Xcode y `xcodegen`:

```bash
pnpm --filter @orivue/desktop ios:init
node apps/desktop/scripts/patch-ios-project.mjs   # ATS para loopback y HTTP
pnpm --filter @orivue/desktop ios:dev
```

`gen/apple` no se versiona porque la CLI de Linux no puede generarlo; CI lo
crea en un runner macOS y compila una app de simulador sin firma.

## Seguridad

- El frontend solo recibe `core:default` y `orivue-native:default`.
- CSP limita scripts a la app y conexiones a loopback.
- El proxy se apaga al cerrar la app y cancela las sesiones.
- `ORIVUE`-style variables de entorno ya no existen: toda la configuración
  vive en Ajustes y en el almacén local.

## Iconos

`src-tauri/icons/orivue-source.svg` es un recurso original. Los PNG/ICO/ICNS
y los iconos Android/iOS se derivan con `pnpm --filter @orivue/desktop icons`.

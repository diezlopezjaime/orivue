# Plataformas y matriz de reproducción

Orivue se construye desde un único proyecto Tauri 2 (`apps/desktop`). La UI
React y el núcleo (`packages/engine`) son los mismos en todas las plataformas;
cambian el backend de reproducción y el empaquetado.

## Estado por plataforma

| Plataforma         | Artefacto                      | Backend de reproducción                 | Validación                         |
| ------------------ | ------------------------------ | --------------------------------------- | ---------------------------------- |
| Linux (x64)        | `.deb`, `.AppImage`, `.rpm`    | Web (mpegts.js / hls.js)                | Compilado y probado en CI Linux    |
| Windows (x64)      | `.exe` NSIS, `.msi`            | Web (WebView2: mpegts.js / hls.js)      | Compilado en CI; no probado a mano |
| macOS (arm64/x64)  | `.dmg`, `.app`                 | Web (WebKit: HLS nativo, mpegts.js)     | Compilado en CI; no probado a mano |
| Android 7+         | `.apk` universal (debug key)   | Nativo Media3/ExoPlayer; web de reserva | Compilado en CI; no en dispositivo |
| Fire TV Stick      | mismo `.apk` (sideload)        | Nativo Media3/ExoPlayer; web de reserva | Compilado en CI; no en dispositivo |
| iOS 17.1+          | `.app` de simulador sin firma  | Web (HLS nativo WebKit, mpegts.js MMS)  | Compilado en CI macOS; no probado  |

"Compilado en CI" significa que el workflow produce el artefacto; no implica
que se haya ejecutado en el dispositivo. La fila se actualizará cuando exista
una prueba manual registrada en el changelog.

## Formatos admitidos

| Formato de stream           | Escritorio (web)       | Android / Fire TV (nativo) | iOS (web)                     |
| --------------------------- | ---------------------- | -------------------------- | ----------------------------- |
| HLS `.m3u8` (H.264/AAC)     | Sí                     | Sí                         | Sí, nativo                    |
| HLS con AC-3/EC-3           | No (MSE)               | Sí                         | Sí, nativo                    |
| MPEG-TS directo H.264/AAC   | Sí (mpegts.js)         | Sí                         | Sí (ManagedMediaSource)       |
| MPEG-TS con MP2/AC-3/MPEG-2 | No                     | Sí                         | No                            |
| MPEG-TS H.265               | Depende del hardware   | Depende del hardware       | No                            |
| HTTP progresivo MP4/MKV     | MP4 sí; MKV no         | Sí                         | MP4 sí; MKV no                |
| `acestream://`              | Con motor local        | Con app Ace Stream         | No                            |

Cuando un stream no puede decodificarse, el reproductor muestra el motivo en
lugar de quedarse cargando.

## Cómo obtener e instalar cada artefacto

Los workflows de GitHub Actions publican artefactos en cada ejecución y, al
etiquetar `v*`, en la release correspondiente.

### Escritorio

Descarga el instalador de tu sistema desde la release. Ninguno está firmado:
Windows SmartScreen y Gatekeeper mostrarán un aviso. En macOS puede ser
necesario `xattr -d com.apple.quarantine Orivue.app`.

### Android (móvil y tablet)

1. Activa "Instalar apps desconocidas" para el navegador o gestor de archivos.
2. Descarga `orivue-universal.apk` y ábrelo.

### Fire TV Stick (sideload)

1. En Fire TV: Ajustes → Mi Fire TV → Opciones para desarrolladores → activa
   "Depuración ADB" y "Aplicaciones de origen desconocido".
2. Desde un ordenador en la misma red:

   ```bash
   adb connect <IP-del-Fire-TV>:5555
   adb install -r orivue-universal.apk
   ```

   También puedes usar la app "Downloader" del Appstore e introducir la URL
   del APK publicado en la release.

3. Orivue aparece en "Tus aplicaciones y canales". El mando funciona con el
   anillo direccional, OK, Atrás, Reproducir/Pausa y Menú (ajustes del
   reproductor).

### iOS

El artefacto de CI es un `.app` para simulador, sin firma. Para instalarlo en
un iPhone hace falta un equipo de desarrollo Apple: abre
`apps/desktop/src-tauri/gen/apple/orivue.xcodeproj` tras `pnpm tauri ios init`
en macOS, configura la firma y ejecuta `pnpm tauri ios build`.

## Navegación con mando (modo TV)

El modo TV se activa automáticamente en Fire TV y Android TV (user agent o
ausencia de pantalla táctil con pantalla grande) y puede forzarse en Ajustes.
Aumenta tamaños y anillos de foco, añade margen de overscan y oculta los
elementos que requieren ratón. Teclas:

| Mando / teclado          | Acción                                    |
| ------------------------ | ----------------------------------------- |
| Anillo direccional       | Mover el foco                             |
| OK / Enter               | Activar                                   |
| Atrás / Esc / Backspace  | Cerrar reproductor o volver               |
| Arriba/Abajo en el vídeo | Canal anterior / siguiente                |
| Reproducir/Pausa         | Pausar (solo backend nativo o VOD)        |
| Menú / M                 | Mostrar controles del reproductor         |

# Escritorio Orivue (Tauri 2)

Contenedor nativo de la web y supervisor del servicio local. Windows es el
objetivo inicial; Linux y macOS son experimentales.

## Desarrollo

Requiere Node/pnpm, Rust estable y los [prerrequisitos oficiales de Tauri
2](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm --filter @orivue/desktop desktop:dev
```

`beforeDevCommand` inicia web y servicio mediante sus scripts pnpm. En debug se
aplica `tauri.dev.conf.json`, que elimina `externalBin`: no se arranca ni exige
un sidecar empaquetado y el servicio de desarrollo mantiene su propio ciclo de
vida.

## Build

```bash
pnpm --filter @orivue/desktop desktop:build
```

`desktop:build` prepara el sidecar antes de invocar Tauri. Para ejecutar
`desktop:check` directamente, prepara primero el sidecar del target con
`prepare:sidecar`, porque `generate_context!` valida el binario configurado.

El build ejecuta este flujo:

1. compila `@orivue/server` a `apps/server/dist/index.js`;
2. obtiene el target triple de Rust;
3. `@yao-pkg/pkg` genera un ejecutable Node para la plataforma actual;
4. lo escribe como
   `src-tauri/binaries/orivue-service-<target-triple>[.exe]`;
5. Tauri compila la web, incluye el sidecar y genera el bundle.

No se debe hacer commit de los binarios generados. El ejecutable Windows x64 se
empaquetó, arrancó con puerto dinámico y respondió al health check el 2026-07-18.
Rust 1.97.1 generó `Cargo.lock`. `cargo check` comenzó a compilar dependencias,
pero el host no dispone de `link.exe` de MSVC Build Tools, por lo que la capa
Rust y el instalador no se completaron localmente. Nuevas dependencias
nativas/assets dinámicos deberán validarse o declararse explícitamente; si `pkg`
no puede resolverlos, se sustituirá el empaquetador mediante otro ADR.

CI puede definir `ORIVUE_TARGET_TRIPLE` para un target explícito. El valor se
valida y solo se aceptan las familias Windows, Linux y macOS contempladas; si no
se define, se obtiene mediante `rustc --print host-tuple`.

## Contrato del sidecar

Entrada compilada: `apps/server/dist/index.js`.

Tauri establece por entorno (no como argumentos visibles):

| Variable             | Valor/propósito                        |
| -------------------- | -------------------------------------- |
| `ORIVUE_HOST`        | `127.0.0.1`, obligatorio en producción |
| `ORIVUE_PORT`        | `0`, el sistema elige un puerto libre  |
| `ORIVUE_LOCAL_TOKEN` | UUID aleatorio por ejecución           |
| `ORIVUE_DATA_DIR`    | Directorio de datos de la app          |
| `ORIVUE_DB_PATH`     | `<data-dir>/orivue.sqlite`             |

La primera línea útil de stdout debe ser JSON:

```json
{ "event": "ready", "port": 43127 }
```

Tauri solo interpreta ese mensaje; no refleja stdout/stderr sin sanitizar en el
frontend. Conserva el handle del proceso y llama a `kill` al salir. La UI puede
invocar `service_connection` para recibir `baseUrl` y token desde Rust una vez
disponible. Si el proceso termina, se borra la conexión y se emite únicamente un
estado genérico.

El runtime empaquetado es Node 22 y actualmente avisa de que `node:sqlite` es
experimental. Es una limitación conocida, no un fallo ocultado.

## Seguridad

- El frontend solo recibe capacidades `core:default`; no puede ejecutar shell.
- CSP limita scripts a la aplicación y conexiones a loopback.
- El sidecar y su nombre están declarados de forma estática en `tauri.conf.json`.
- El directorio se crea bajo la ruta de datos que proporciona Tauri.
- `ORIVUE_ALLOW_PRIVATE_NETWORK` no se activa en distribución.
- Ace Stream Engine no se incluye ni se descarga.

El token protege frente a solicitudes casuales desde otros orígenes, no frente a
malware con acceso a memoria/procesos de la misma cuenta.

## Iconos e identidad

`src-tauri/icons/orivue-source.svg` es un recurso original del proyecto. Los
PNG/ICO/ICNS se derivan con:

```bash
pnpm --filter @orivue/desktop icons
```

No sustituyas el SVG por logos o recursos de otros reproductores. El nombre y el
identificador pueden cambiar antes de 1.0, con impacto en rutas/actualizaciones.

## Releases

`.github/workflows/release-tauri.yml` verifica el monorepo y crea un **draft
prerelease** de Windows para tags `v*`. No publica automáticamente: un mantenedor
debe comprobar artefactos y changelog. No hay certificado de firma; SmartScreen
puede mostrar advertencias. Linux/macOS no se publican hasta validarlos.

El workflow exige el `Cargo.lock` versionado. Para actualizarlo de forma
deliberada, ejecuta:

```bash
cargo generate-lockfile --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Revisa y versiona el resultado. Esta barrera evita llamar reproducible a un
release que resolvería dependencias Rust en ese momento. El build Windows
requiere además MSVC Build Tools con la carga de desarrollo C++.

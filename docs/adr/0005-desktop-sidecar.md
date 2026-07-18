# ADR-0005: servicio empaquetado como sidecar supervisado

- Estado: aceptado; sidecar Windows validado, contenedor Tauri pendiente
- Fecha: 2026-07-18

## Contexto

La UI necesita el servicio Node local. Pedir Node al usuario final empeora la
instalación; iniciar un proceso sin supervisión crea huérfanos y puede reutilizar
tokens o rutas equivocadas.

## Decisión

Tauri 2 empaqueta un ejecutable `orivue-service` específico del target triple.
En producción, Rust lo arranca con host loopback, puerto dinámico, token aleatorio
y directorio de datos Tauri. El servicio anuncia disponibilidad con una línea
JSON y Tauri conserva el handle para terminarlo en `RunEvent::ExitRequested` y
`RunEvent::Exit`.

El binario se genera a partir de `apps/server/dist/index.js` con un empaquetador
Node compatible (inicialmente `@yao-pkg/pkg`) durante CI. No se redistribuye Node
por separado ni Ace Stream.

## Consecuencias

Cada plataforma necesita un sidecar con nombre `orivue-service-<target-triple>`
y pruebas de cierre. El sidecar Windows x64 arrancó y respondió al health check
el 2026-07-18; el runtime informa que `node:sqlite` sigue siendo experimental.
Dependencias Node nativas pueden requerir recursos o una estrategia distinta.
Hasta compilar Rust y validar el instalador, Tauri no se considera una
distribución terminada.

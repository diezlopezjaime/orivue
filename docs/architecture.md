# Arquitectura

Orivue es una aplicación local-first en un monorepo pnpm. Se evita distribuir
funcionalidad como microservicios: existe un único servicio local y una única
sesión de reproducción activa por defecto.

## Componentes

| Ruta                        | Responsabilidad                                               |
| --------------------------- | ------------------------------------------------------------- |
| `apps/web`                  | UI React/Vite, navegación TV, virtualización y reproductor    |
| `apps/server`               | API Fastify loopback, persistencia y coordinación de sesiones |
| `apps/desktop`              | Contenedor Tauri 2 y supervisión del sidecar                  |
| `packages/core`             | Entidades y contratos de dominio sin infraestructura          |
| `packages/m3u-parser`       | Lectura tolerante y acotada de M3U                            |
| `packages/xmltv-parser`     | Lectura incremental y normalización temporal XMLTV            |
| `packages/stream-resolvers` | Resolutores HLS, HTTP y Ace Stream opcional                   |
| `packages/player`           | Ciclo de vida de reproducción independiente de la UI          |
| `fixtures`                  | Datos sintéticos reproducibles y sin contenido protegido      |

La lista real de paquetes puede crecer solo cuando exista una responsabilidad
compartida concreta; no se crean paquetes como abstracciones vacías.

## Flujo principal

1. La UI solicita importar una fuente autorizada.
2. El servicio valida esquema, destino, redirecciones, tamaño y tiempo.
3. El parser produce entradas y avisos sin retener innecesariamente todo el
   archivo; el servicio prepara una revisión en transacción.
4. Solo una revisión válida sustituye a la anterior. Los IDs estables preservan
   favoritos y personalizaciones.
5. Al reproducir, el servicio crea una sesión ligada a un canal persistido. El
   cliente no proporciona una URL libre al proxy.
6. El resolutor devuelve un destino reproducible y una función de limpieza. Un
   cambio cancela solicitudes y termina la sesión previa.

## Persistencia

SQLite reside en el directorio de datos de la aplicación, nunca en el directorio
instalable. Migraciones versionadas avanzan el esquema. Importaciones usan una
transacción y tablas/estado de preparación para no destruir la última revisión
útil si la red o el parser fallan.

Las URLs de fuentes pueden contener secretos. El servicio las necesita para
actualizar, pero nunca las incluye sin redactar en logs, errores o diagnósticos.
El cifrado con almacén nativo no forma parte del alcance inicial; el archivo se
protege con permisos de la cuenta del sistema operativo.

## Procesos de escritorio

En desarrollo, web y servicio se ejecutan mediante pnpm y Tauri carga Vite. En
distribución, Tauri incluye `orivue-service-<target-triple>` como sidecar. Tauri
genera token local y directorio de datos, arranca el servicio con bind loopback,
lee un evento JSON `ready` y lo detiene al salir. El sidecar no se expone a LAN.

El contrato exacto está en `apps/desktop/README.md` y la decisión en
`docs/adr/0005-desktop-sidecar.md`.

## Decisiones registradas

- [ADR-0001: monorepo local-first](adr/0001-monorepo-local-first.md)
- [ADR-0002: identidad estable de canales](adr/0002-stable-channel-identities.md)
- [ADR-0003: seguridad loopback](adr/0003-loopback-security.md)
- [ADR-0004: resolutores separados](adr/0004-stream-resolvers.md)
- [ADR-0005: servicio sidecar supervisado](adr/0005-desktop-sidecar.md)

Cada ADR describe contexto y compromisos. Una decisión nueva que amplíe la
superficie de red, cambie el almacenamiento de secretos o rompa contratos
públicos necesita otro ADR.

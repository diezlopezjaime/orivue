# ADR-0001: monorepo pnpm y arquitectura local-first

- Estado: aceptado
- Fecha: 2026-07-18

## Contexto

Frontend, servicio, parsers y escritorio evolucionan juntos y comparten tipos.
Una infraestructura distribuida añadiría despliegues, telemetría y exposición de
red sin aportar valor al reproductor local.

## Decisión

Usar un monorepo pnpm con aplicaciones en `apps/*`, código compartido en
`packages/*`, un servicio Fastify único enlazado a loopback y SQLite local.

## Consecuencias

Los cambios atómicos de contrato son sencillos y no se necesita una cuenta
remota. A cambio, el escritorio debe empaquetar/supervisar el servicio y el
monorepo exige disciplina para no crear dependencias circulares.

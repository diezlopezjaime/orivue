# ADR-0003: API loopback autenticada y proxy restringido

- Estado: aceptado
- Fecha: 2026-07-18

## Contexto

Un puerto en `127.0.0.1` también puede recibir peticiones iniciadas por páginas
web maliciosas. Un proxy que acepte URLs libres habilita SSRF y acceso a redes
internas.

## Decisión

Enlazar exclusivamente a loopback por defecto, exigir token local efímero,
validar `Origin`/método/content-type y hacer que las sesiones de proxy nazcan de
canales persistidos. Resolver DNS y validar cada redirección; bloquear destinos
locales, privados, link-local y metadata salvo excepciones de desarrollo
explícitas. Limitar tamaños, tiempos, redirects y concurrencia.

## Consecuencias

Orígenes inusuales pueden requerir configuración o no funcionar. Esta fricción
se acepta para impedir que Orivue sea un proxy abierto. Loopback no protege de
malware ejecutado con la misma cuenta.

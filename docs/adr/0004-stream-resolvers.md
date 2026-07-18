# ADR-0004: resolutores de stream desacoplados

- Estado: aceptado
- Fecha: 2026-07-18

## Contexto

HLS, HTTP directo y motores externos tienen detección, resolución, errores y
limpieza diferentes. Mezclarlos en el reproductor dificulta cancelar sesiones.

## Decisión

Cada adaptador implementa conceptualmente `supports`, `resolve` y `stop`. La
coordinación mantiene una sola sesión activa y llama a `stop` incluso ante
cambio rápido o cierre. Ace Stream es opcional, configurable y nunca se incluye.

## Consecuencias

Se pueden probar los adaptadores con dobles. La integración Ace real sigue
dependiendo de APIs externas y debe validarse físicamente antes de declararla
compatible.

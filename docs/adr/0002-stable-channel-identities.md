# ADR-0002: identidad estable de canales

- Estado: aceptado
- Fecha: 2026-07-18

## Contexto

Las actualizaciones de una lista cambian orden, logos, nombres o URLs. Un ID de
fila aleatorio perdería favoritos, ocultaciones y asociaciones EPG.

## Decisión

Derivar una clave estable de la identidad de la playlist más los campos de mayor
estabilidad: `tvg-id` cuando existe y, como alternativa, una combinación
normalizada de nombre/grupo y origen. Duplicados reciben un discriminador
determinista. La URL completa no se usa como único identificador ni se expone.

## Consecuencias

Se conservan personalizaciones en la mayoría de actualizaciones. Un proveedor
que cambie simultáneamente todos los campos puede producir un canal nuevo; las
colisiones deben detectarse y resolverse de forma determinista.

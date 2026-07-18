# Guía de `good first issue`

La etiqueta `good first issue` se reserva para tareas pequeñas, acotadas y con
criterios verificables. También puede añadirse `help wanted`, `area: web`,
`area: server`, `area: parser`, `area: desktop`, `documentation` o `tests`.

## Para mantenedores

Un issue inicial debe incluir:

- contexto y archivos probables;
- comportamiento actual y esperado;
- criterios de aceptación objetivos;
- datos sintéticos disponibles;
- pruebas/comandos recomendados;
- riesgos y tareas explícitamente fuera de alcance;
- disposición a orientar a una persona nueva.

No etiquetes así migraciones destructivas, cambios de seguridad sensibles,
refactors abiertos ni bugs que necesiten una lista privada para reproducirse.

## Ideas preparadas

1. **Añadir casos Unicode al fixture M3U.** Incluir nombres RTL/acentuados y un
   test; no cambiar el parser fuera de lo que el test revele.
2. **Fallback accesible de logo.** Añadir texto/estado para imagen rota y test de
   componente; mantener navegación de teclado.
3. **Documentar un error frecuente.** Reproducirlo con fixture sintético y añadir
   solución al README sin mostrar URLs reales.
4. **Test de zona horaria XMLTV.** Cubrir un cambio DST con fechas ficticias.
5. **Mejorar mensajes de lista vacía.** Copy en español claro, ARIA y captura en
   720p/1080p.
6. **Comprobar redacción de un nombre de query.** Añadir un caso parametrizado
   para `token`, `key` o `password`, sin usar secretos auténticos.

Antes de trabajar, comenta el issue para evitar duplicidad. Si descubres que el
alcance es mayor o de seguridad, detente y pide reclasificación.

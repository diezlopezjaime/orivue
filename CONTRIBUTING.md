# Contribuir a Orivue

Gracias por mejorar Orivue. Buscamos cambios pequeños, comprobables y seguros.
No se exige un CLA: toda contribución aceptada se publica bajo la misma licencia
MIT del proyecto.

## Antes de empezar

- Busca un issue existente; para cambios grandes, abre una propuesta primero.
- Usa únicamente fixtures sintéticos o contenido que puedas redistribuir.
- Nunca publiques listas privadas, tokens, credenciales, cookies, IP públicas ni
  diagnósticos sin sanitizar.
- Las vulnerabilidades no se reportan en issues públicos: consulta `SECURITY.md`.
- Respeta `CODE_OF_CONDUCT.md`.

## Preparar el entorno

```bash
corepack enable
pnpm install
pnpm verify
```

Node 22+ y pnpm 11 son necesarios. Rust solo hace falta para `apps/desktop`.

## Flujo recomendado

1. Crea una rama desde `main`: `feat/...`, `fix/...`, `docs/...` o `test/...`.
2. Añade o actualiza tests que fallen sin tu corrección.
3. Mantén los contratos TypeScript estrictos y evita `any` sin justificar.
4. Ejecuta al menos las comprobaciones relacionadas con tu cambio.
5. Actualiza documentación y `CHANGELOG.md` si el comportamiento público cambia.
6. Abre un PR con alcance, riesgos, pruebas **realmente ejecutadas** y capturas
   sanitizadas si cambia la UI.

No incluyas refactors ajenos al objetivo. No se requieren commits perfectos,
pero sí mensajes comprensibles y ausencia de secretos.

## Comprobaciones

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e       # si el cambio afecta flujos de interfaz
```

Para escritorio:

```bash
pnpm --filter @orivue/desktop desktop:check
pnpm --filter @orivue/desktop desktop:build
```

Indica “no ejecutado” junto con la causa si tu entorno no permite una prueba.
No sustituyas una prueba pendiente por una afirmación de éxito.

## Convenciones

- TypeScript estricto, Prettier y ESLint mandan sobre preferencias personales.
- API y errores no deben reflejar URLs sensibles.
- El servicio sigue escuchando en `127.0.0.1`; ampliar exposición requiere ADR y
  revisión de seguridad.
- Los resolutores implementan una interfaz común y deben poder cancelar/limpiar
  sesiones.
- Un parser tolera entradas aisladas defectuosas, pero conserva límites globales.
- Los cambios de esquema incluyen migración hacia delante y prueba transaccional.

## Pull requests

Un PR listo para revisar incluye:

- problema y solución;
- impacto visible y compatibilidad;
- riesgos de privacidad/SSRF/CORS si toca red;
- comandos ejecutados y resultados;
- datos de prueba legales;
- documentación actualizada.

El mantenimiento puede pedir dividir cambios, añadir tests o retirar datos
sensibles. Los PR generados con asistencia automática son bienvenidos si el
autor los ha revisado y puede responder por ellos.

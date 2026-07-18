# API local

Documento de orientación para `0.1.x`. El contrato efectivo tipado del código
prevalece y puede cambiar antes de 1.0.

## Transporte y autenticación

- Base: `http://127.0.0.1:<puerto>/api`.
- El puerto puede ser dinámico en escritorio.
- Las rutas exigen el token local establecido al arrancar el servicio.
- Solo se admiten orígenes de la web/ventana de Orivue; no se usa CORS `*`.
- Respuestas de error nunca incluyen URLs completas ni cabeceras sensibles.
- IDs son opacos. Fechas se expresan como ISO 8601 UTC salvo zona explícita.

Cabecera actual de `0.1.x`:

```http
X-Orivue-Token: <token-local-efímero>
Content-Type: application/json
```

## Recursos

| Método y ruta                            | Función                                   |
| ---------------------------------------- | ----------------------------------------- |
| `GET /api/health`                        | Estado mínimo, autenticado y sin secretos |
| `GET /api/playlists`                     | Listar fuentes con URL redactada          |
| `POST /api/playlists`                    | Crear fuente M3U autorizada               |
| `PATCH /api/playlists/:id`               | Renombrar/configurar                      |
| `DELETE /api/playlists/:id`              | Eliminar fuente y datos relacionados      |
| `POST /api/playlists/:id/refresh`        | Actualización transaccional manual        |
| `GET /api/groups`                        | Grupos visibles/ocultos                   |
| `GET /api/channels`                      | Canales paginados, filtrados u ordenados  |
| `GET /api/channels/:id`                  | Detalle sin exponer credenciales          |
| `PATCH /api/channels/:id`                | Ocultación/nombre/orden personalizados    |
| `GET /api/favorites`                     | Favoritos                                 |
| `POST /api/favorites/:channelId`         | Marcar favorito (idempotente)             |
| `DELETE /api/favorites/:channelId`       | Desmarcar favorito                        |
| `GET /api/recents`                       | Reproducciones recientes                  |
| `GET /api/epg/now`                       | Programa actual/siguiente                 |
| `GET /api/epg/timeline`                  | Ventana temporal acotada                  |
| `POST /api/playback/sessions`            | Resolver un `channelId` persistido        |
| `DELETE /api/playback/sessions/:id`      | Cancelar y limpiar sesión                 |
| `GET /api/integrations/acestream/status` | Estado del motor configurado              |

La creación de sesión acepta un `channelId`, no una URL remota arbitraria. El
proxy usa una capacidad/sesión opaca de vida corta y revalida redirecciones.

## Errores y paginación

Formato recomendado:

```json
{
  "error": {
    "code": "PLAYBACK_SOURCE_UNAVAILABLE",
    "message": "No se pudo conectar con el origen",
    "requestId": "req_..."
  }
}
```

`message` es apto para usuario y está redactado; detalles técnicos sanitizados
se vinculan por `requestId`. Colecciones grandes usan cursor/límite. La API
rechaza límites excesivos y ventanas EPG sin acotar.

## Eventos de reproducción

Las sesiones representan `connecting`, `buffering`, `playing`, `retrying`,
`failed` o `stopped`. Cerrar una sesión es idempotente. SSE u otro transporte de
eventos debe mantener token, origen y cancelación; no se expone un stream de
eventos global sin ámbito de sesión.

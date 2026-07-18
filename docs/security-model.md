# Modelo de seguridad

## Activos y fronteras

Activos: URLs de fuentes, credenciales embebidas, preferencias, historial,
SQLite, token local y destinos de reproducción. No son de confianza: M3U/XMLTV,
logos, streams, redirects, DNS, motores externos, páginas web abiertas en el
equipo y archivos importados.

La cuenta local y el sistema operativo sí forman parte de la base de confianza.
Orivue no pretende resistir malware con los mismos permisos del usuario.

## Controles

### API, CORS y CSRF

- bind a `127.0.0.1`/`::1` validado, nunca `0.0.0.0` por defecto;
- token aleatorio por ejecución, comparación segura y sin query string;
- allowlist exacta de `Origin`; rechazo de `null` salvo canal Tauri definido;
- métodos mutantes con JSON y autenticación, sin formularios simples;
- límites de cuerpo y rate/concurrency; respuestas redactadas.

### SSRF, DNS y redirects

- solo esquemas `http`/`https` para fuentes y streams; protocolos especiales se
  entregan a resolutores explícitos;
- resolución DNS antes de conectar y bloqueo de loopback, privadas, link-local,
  multicast, documentación y metadata cloud;
- revalidación de cada redirect y límites estrictos;
- proxy derivado de un canal importado, nunca `?url=<arbitraria>`;
- allowlist mínima de cabeceras; se eliminan `Cookie`, `Authorization` y
  cabeceras hop-by-hop salvo configuración segura ligada a la fuente.

Una comprobación DNS previa no elimina por sí sola el rebinding: el cliente de
red debe conectar al resultado validado o verificar la dirección efectiva.

### Parsers y recursos

- tamaño descargado, tiempo, redirects y compresión acotados;
- procesamiento incremental; XML sin DTD ni entidades externas;
- profundidad/longitud de campos y cantidad de avisos limitadas;
- transacciones: una importación fallida no sustituye datos válidos;
- logos se tratan como contenido no confiable, con lazy loading y fallback.

### Secretos y logs

- redacción de userinfo, query sensible, tokens y cabeceras;
- mensajes estructurados para evitar inyección de saltos de línea;
- diagnóstico por allowlist, no volcado completo de entorno/base de datos;
- URLs completas no se muestran en listados ni errores;
- SQLite bajo el directorio de datos con permisos del usuario.

Limitación: en `0.1.x` las URLs necesarias para actualizar pueden quedar en
SQLite sin cifrado de almacén nativo. No compartas esa base ni backups.

### Tauri y sidecar

- CSP restrictiva y capacidades mínimas;
- ninguna API shell se expone al frontend;
- nombre/ruta del sidecar fijados en la configuración, sin comandos arbitrarios;
- token y directorio se pasan por entorno, no por argumentos visibles;
- Tauri mantiene el handle y mata el hijo al cerrar;
- instaladores sin firma se identifican claramente, nunca se oculta la alerta.

## Abuso no soportado

Orivue no incluye contenido ni ayuda a eludir DRM, pagos, autenticación o
restricciones. Ace Stream es externo y opcional. No se incorporan identificadores
de emisiones reales en tests.

## Diagnósticos sanitizados

Un export futuro/actual debe incluir solo versión, plataforma, estados,
duraciones, códigos de error y contadores. Debe reemplazar hosts/paths/queries,
tokens, nombres sensibles y rutas de usuario. Revisa siempre el archivo antes de
compartirlo; la sanitización automática reduce riesgo pero no es infalible.

## Checklist de revisión

- [ ] El servicio solo escucha en loopback.
- [ ] Origen y token se prueban con casos negativos.
- [ ] No existe endpoint proxy de URL libre.
- [ ] DNS y todos los redirects se revalidan.
- [ ] Logs/tests no contienen secretos reconocibles.
- [ ] XML externo/DTD está deshabilitado y los límites tienen tests.
- [ ] Cambiar/cerrar canal cancela red y resolutor.
- [ ] El sidecar termina con la ventana y ante fallo de inicio.
- [ ] `pnpm audit` y CodeQL se han revisado, no solo ejecutado.

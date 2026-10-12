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
  cabeceras hop-by-hop salvo configuración segura ligada a la fuente;
- `User-Agent` por defecto `VLC/3.0.21 LibVLC/3.0.21`: identificarse como
  Orivue hacía que algunos paneles descartaran las peticiones sin responder.
  El usuario puede fijar otro en Ajustes y una lista puede indicarlo por canal.

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

Limitación: las fuentes, incluidas las credenciales Xtream, se guardan en el
almacén clave-valor de la app sin cifrado adicional. No compartas el directorio
de datos ni sus copias.

### Tauri, proxy loopback y plataformas

- CSP restrictiva y capacidades mínimas; ninguna API shell ni de sistema de
  archivos se expone al frontend, solo los comandos propios y el plugin nativo;
- el proxy escucha en `127.0.0.1` con puerto aleatorio y token de 256 bits por
  ejecución; el token viaja en la ruta porque `<video>` no puede añadir
  cabeceras, y solo la app lo conoce;
- cada sesión nace de un canal importado y mantiene una lista de orígenes
  permitidos: el del canal, los de sus redirecciones y los referenciados por el
  manifiesto HLS; cualquier otra URL recibe 403;
- CORS del proxy solo responde a los orígenes de la webview de Tauri y de los
  servidores de desarrollo; nunca `*`;
- destinos loopback, privados, link-local y multicast se bloquean; Ace Stream
  solo habilita loopback y la opción de red local es explícita del usuario. La
  comprobación DNS es previa a la conexión, así que el rebinding posterior no
  queda cubierto;
- el reproductor nativo de Android recibe la URL del canal directamente, sin
  pasar por el proxy; la fuente la eligió el usuario;
- Android permite tráfico en claro y iOS lleva excepciones ATS porque las
  fuentes IPTV suelen ser HTTP; ambas decisiones están documentadas;
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

- [ ] El proxy solo escucha en loopback y exige token.
- [ ] Origen y token se prueban con casos negativos (`crates/stream-proxy/tests`).
- [ ] No existe endpoint proxy de URL libre: toda URL pertenece a una sesión.
- [ ] DNS y todos los redirects se revalidan.
- [ ] Logs/tests no contienen secretos reconocibles.
- [ ] XML externo/DTD está deshabilitado y los límites tienen tests.
- [ ] Cambiar/cerrar canal cancela red y resolutor.
- [ ] Cerrar la app apaga el proxy y cancela las sesiones.
- [ ] `pnpm audit` y CodeQL se han revisado, no solo ejecutado.

# Política de seguridad

## Versiones con soporte

Mientras Orivue sea anterior a 1.0, solo la última revisión de `main` y la última
preversión publicada reciben correcciones de seguridad. La API puede cambiar al
corregir un riesgo.

## Reportar una vulnerabilidad

Usa **GitHub Private Vulnerability Reporting** en la pestaña Security del
repositorio. Si aún no está disponible, contacta privadamente al propietario a
través de su perfil de GitHub y pide un canal seguro **sin incluir todavía el
exploit ni secretos**. No abras un issue público.

Incluye, una vez establecido el canal privado:

- versión/commit y sistema operativo;
- impacto y prerrequisitos;
- pasos mínimos con datos sintéticos;
- propuesta de mitigación, si existe;
- si crees que hay explotación activa.

No envíes listas reales, credenciales, tokens, cookies, bases SQLite, datos de
proveedores ni URLs completas. Sustituye host, path y query por valores
ficticios preservando solo la estructura necesaria.

Intentaremos acusar recibo en 7 días, clasificar en 14 y coordinar una corrección
antes de divulgar. Son objetivos, no una garantía contractual. No se ofrece
programa de recompensas.

## Alcance prioritario

- SSRF, DNS rebinding o conversión del proxy en proxy abierto.
- Acceso a la API local desde orígenes web no autorizados.
- Bypass del token de sesión, CSRF o CORS.
- Exposición de credenciales en logs, diagnósticos, errores o UI.
- Path traversal y escritura fuera de los directorios de datos.
- XML/M3U malicioso que cause consumo descontrolado o inyección.
- Ejecución de comandos o escape del sidecar/Tauri.
- Dependencias vulnerables con ruta de explotación real.

Quedan fuera los fallos exclusivos de un proveedor/stream externo, ingeniería
social, DoS que requiera control total del equipo local y peticiones para eludir
DRM o accesos de pago. Aun así, informa privadamente si dudas.

## Divulgación responsable

Evita acceder a datos ajenos, persistir, interrumpir servicios o ampliar la
prueba más de lo imprescindible. Daremos crédito si lo deseas y si la ley o la
privacidad no lo impiden.

El diseño de amenazas y las limitaciones están en `docs/security-model.md`.

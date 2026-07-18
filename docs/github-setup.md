# Configuración del repositorio GitHub

Pasos manuales y seguros después de crear el repositorio público. No requieren
tokens en archivos ni workflows.

## Metadatos

- Descripción: `Reproductor IPTV local-first y open source para tus propias fuentes autorizadas.`
- Sitio web: vacío hasta disponer de una página útil y mantenida.
- Temas: `iptv-player`, `m3u`, `xmltv`, `hls`, `react`, `tauri`, `typescript`,
  `local-first`, `open-source`.
- Licencia detectada: MIT.
- Issues y Discussions: habilitar Issues; Discussions es opcional.
- Pages: no habilitar para el MVP.

## Seguridad

1. Habilitar **Private vulnerability reporting**.
2. Habilitar Dependabot alerts y security updates.
3. Revisar que Actions solo pueda crear/aprobar PR si se desea expresamente;
   no es necesario para los workflows iniciales.
4. Mantener secretos de firma fuera del repositorio. No hay firma en `0.1.x`.
5. Aplicar el ruleset de `.github/BRANCH_PROTECTION.md` tras observar los nombres
   reales de checks en una ejecución satisfactoria.

## Etiquetas sugeridas

`bug`, `enhancement`, `triage`, `security`, `dependencies`, `documentation`,
`tests`, `good first issue`, `help wanted`, `area: web`, `area: server`,
`area: parser`, `area: desktop`, `javascript`, `rust`, `ci`.

No uses una etiqueta pública para una vulnerabilidad no corregida. El issue
template impide informes en blanco y deriva la seguridad a `SECURITY.md`.

## Release inicial

No crear `v0.1.0` solo para probar el workflow. Antes del tag:

- `pnpm verify` y E2E relevantes en limpio;
- auditoría de secretos y dependencias;
- build Tauri reproducido en Windows;
- changelog sin placeholders;
- commit/tag coinciden con la versión de raíz y Tauri;
- release draft revisada y claramente marcada prerelease;
- hashes/artefactos revisados y limitación de firma documentada.

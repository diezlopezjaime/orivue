# Changelog

Todos los cambios notables se documentarán aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## Unreleased

### Añadido

- Estructura inicial del monorepo Orivue.
- Documentación de arquitectura, API, seguridad y contribución.
- Automatización de CI para Windows/Linux, CodeQL y releases Tauri.
- Configuración inicial de Tauri 2 y contrato de ciclo de vida del servicio.

### Seguridad

- Política para evitar publicar listas, tokens y credenciales.
- Modelo de amenazas para API loopback, proxy, importadores y escritorio.

### Pendiente de validar

- Build Tauri/Rust e instalador local: Rust 1.97.1 generó `Cargo.lock`, pero
  `cargo check` no puede enlazar dependencias sin `link.exe` de MSVC Build Tools.
  El sidecar Windows sí fue empaquetado, arrancado, consultado por health y
  detenido con datos ficticios.
- Workflows de GitHub Actions: se ejecutarán cuando exista repositorio remoto.
- Integración con un motor Ace Stream físico; solo se contempla simulación.

## 0.1.0 - Sin publicar

Preversión objetivo. No debe etiquetarse hasta que la auditoría final confirme
MVP, pruebas relevantes, build reproducible y ausencia de secretos. Se añadirán
los enlaces de comparación al conocer la URL pública definitiva.

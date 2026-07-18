# Protección recomendada de `main`

Aplicar después de la primera ejecución satisfactoria de CI:

- exigir pull request con al menos una aprobación;
- descartar aprobaciones al recibir commits nuevos;
- exigir resolución de conversaciones;
- exigir rama actualizada y checks `quality` de Linux y Windows;
- exigir CodeQL cuando esté disponible;
- bloquear force-push y borrado de `main`;
- aplicar las reglas también a administradores, con procedimiento documentado de
  emergencia;
- permitir Dependabot, pero no auto-merge de actualizaciones mayores.

No se aplica automáticamente desde el workflow: modificar reglas del repositorio
requiere permisos administrativos y puede bloquear `main` antes de que los nombres
de checks existan. El propietario debe configurarlo desde Settings → Rules →
Rulesets una vez observados los checks reales.

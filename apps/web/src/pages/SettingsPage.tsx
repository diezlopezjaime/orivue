import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EngineSettings } from '@orivue/engine';
import { api } from '../api';
import { useDeviceInfo } from '../hooks/useDevice';
import { useAppStore, type PlayerPreference, type TvModePreference } from '../store';

export function SettingsPage() {
  const device = useDeviceInfo();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings() });
  const update = useMutation({
    mutationFn: (patch: Partial<EngineSettings>) => api.updateSettings(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
  const { tvMode, setTvMode, playerPreference, setPlayerPreference } = useAppStore();
  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">PREFERENCIAS</span>
          <h1>Ajustes</h1>
        </div>
      </header>
      <div className="settings-grid">
        <article className="settings-card">
          <h2>Interfaz</h2>
          <label>
            Modo televisión (10 pies)
            <select
              data-tv-focus
              value={tvMode}
              onChange={(event) => setTvMode(event.target.value as TvModePreference)}
            >
              <option value="auto">Automático ({device.tv ? 'detectado' : 'no detectado'})</option>
              <option value="on">Siempre</option>
              <option value="off">Nunca</option>
            </select>
          </label>
          <p>Aumenta tamaños, foco y márgenes para manejar Orivue con un mando.</p>
        </article>
        <article className="settings-card">
          <h2>Reproductor</h2>
          <label>
            Motor de reproducción
            <select
              data-tv-focus
              value={playerPreference}
              disabled={!device.nativePlayer}
              onChange={(event) => setPlayerPreference(event.target.value as PlayerPreference)}
            >
              <option value="auto">Automático</option>
              <option value="native">Nativo (Media3/ExoPlayer)</option>
              <option value="web">Web (mpegts.js / hls.js)</option>
            </select>
          </label>
          <p>
            {device.nativePlayer
              ? 'El reproductor nativo admite más códecs (MP2, AC-3, MPEG-2) y consume menos batería.'
              : 'En esta plataforma solo está disponible el reproductor web: H.264/AAC en HLS y MPEG-TS.'}
          </p>
        </article>
        <article className="settings-card">
          <h2>Red</h2>
          <label className="checkbox">
            <input
              data-tv-focus
              type="checkbox"
              checked={settings.data?.allowPrivateNetwork ?? false}
              onChange={(event) => update.mutate({ allowPrivateNetwork: event.target.checked })}
            />
            Permitir fuentes en la red local (192.168.x, 10.x, localhost)
          </label>
          <p>
            Desactivado por defecto para que una lista maliciosa no pueda apuntar a servicios de tu
            propia red.
          </p>
          <label>
            Horizonte de guía (horas)
            <input
              data-tv-focus
              type="number"
              min="6"
              max="336"
              value={settings.data?.epgHorizonHours ?? 72}
              onChange={(event) =>
                update.mutate({
                  epgHorizonHours: Math.min(336, Math.max(6, Number(event.target.value) || 72)),
                })
              }
            />
          </label>
        </article>
        <article className="settings-card">
          <h2>Diagnóstico</h2>
          <dl>
            <dt>Plataforma</dt>
            <dd>
              {device.platform}
              {device.tauri ? ' (Tauri)' : ' (navegador)'}
            </dd>
            <dt>Versión</dt>
            <dd>{device.version}</dd>
            <dt>Dispositivo</dt>
            <dd>
              {device.tv ? 'Televisión' : device.mobile ? 'Móvil o tablet' : 'Ordenador'}
              {device.touchscreen ? ', táctil' : ''}
            </dd>
            <dt>Reproductor nativo</dt>
            <dd>{device.nativePlayer ? 'Disponible' : 'No disponible'}</dd>
            <dt>Telemetría</dt>
            <dd>Ninguna. Las listas y credenciales solo se guardan en este dispositivo.</dd>
          </dl>
        </article>
      </div>
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EngineSettings } from '@orivue/engine';
import { api } from '../api';
import { useDeviceInfo } from '../hooks/useDevice';
import { LANGUAGES, setLanguagePreference, useT, type LanguagePreference } from '../i18n';
import { useAppStore, type PlayerPreference, type TvModePreference } from '../store';

export function SettingsPage() {
  const t = useT();
  const device = useDeviceInfo();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings() });
  const update = useMutation({
    mutationFn: (patch: Partial<EngineSettings>) => api.updateSettings(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
  const { tvMode, setTvMode, playerPreference, setPlayerPreference, language, setLanguage } =
    useAppStore();
  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t('settings.eyebrow')}</span>
          <h1>{t('settings.title')}</h1>
        </div>
      </header>
      <div className="settings-grid">
        <article className="settings-card">
          <h2>{t('settings.interface')}</h2>
          <label>
            {t('settings.language')}
            <select
              data-tv-focus
              value={language}
              onChange={(event) => {
                const next = event.target.value as LanguagePreference;
                setLanguage(next);
                setLanguagePreference(next);
              }}
            >
              <option value="auto">{t('settings.languageAuto')}</option>
              {LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('settings.tvMode')}
            <select
              data-tv-focus
              value={tvMode}
              onChange={(event) => setTvMode(event.target.value as TvModePreference)}
            >
              <option value="auto">
                {t('settings.tvAuto', {
                  state: device.tv ? t('settings.detected') : t('settings.notDetected'),
                })}
              </option>
              <option value="on">{t('settings.always')}</option>
              <option value="off">{t('settings.never')}</option>
            </select>
          </label>
          <p>{t('settings.tvHint')}</p>
        </article>
        <article className="settings-card">
          <h2>{t('settings.player')}</h2>
          <label>
            {t('settings.engine')}
            <select
              data-tv-focus
              value={playerPreference}
              disabled={!device.nativePlayer}
              onChange={(event) => setPlayerPreference(event.target.value as PlayerPreference)}
            >
              <option value="auto">{t('settings.engineAuto')}</option>
              <option value="native">{t('settings.engineNative')}</option>
              <option value="web">{t('settings.engineWeb')}</option>
            </select>
          </label>
          <p>{device.nativePlayer ? t('settings.nativeHint') : t('settings.webHint')}</p>
        </article>
        <article className="settings-card">
          <h2>{t('settings.network')}</h2>
          <label className="checkbox">
            <input
              data-tv-focus
              type="checkbox"
              checked={settings.data?.allowPrivateNetwork ?? false}
              onChange={(event) => update.mutate({ allowPrivateNetwork: event.target.checked })}
            />
            {t('settings.privateNetwork')}
          </label>
          <p>{t('settings.privateHint')}</p>
          <label>
            {t('settings.epgHorizon')}
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
          <h2>{t('settings.diagnostics')}</h2>
          <dl>
            <dt>{t('settings.platform')}</dt>
            <dd>
              {device.platform} {device.tauri ? t('settings.tauri') : t('settings.browser')}
            </dd>
            <dt>{t('settings.version')}</dt>
            <dd>{device.version}</dd>
            <dt>{t('settings.device')}</dt>
            <dd>
              {device.tv
                ? t('settings.tv')
                : device.mobile
                  ? t('settings.mobile')
                  : t('settings.desktop')}
              {device.touchscreen ? t('settings.touch') : ''}
            </dd>
            <dt>{t('settings.nativePlayer')}</dt>
            <dd>{device.nativePlayer ? t('settings.available') : t('settings.unavailable')}</dd>
            <dt>{t('settings.telemetry')}</dt>
            <dd>{t('settings.telemetryNone')}</dd>
          </dl>
        </article>
      </div>
    </section>
  );
}

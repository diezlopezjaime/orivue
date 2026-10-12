import { useMutation } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { Dialog } from './Dialog';

/** Export dialog: the configuration as text to copy or download. */
export function ConfigExportDialog({
  includeCredentials,
  onClose,
}: {
  includeCredentials: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [text] = useState(() => JSON.stringify(api.exportConfig(includeCredentials), null, 2));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `orivue-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Dialog title={t('settings.exportTitle')} onClose={onClose} className="config-transfer">
      <p className="dialog-subtitle">{t('settings.exportHint')}</p>
      <textarea readOnly value={text} rows={12} onFocus={(event) => event.target.select()} />
      <div className="dialog-actions">
        <button data-tv-focus type="button" onClick={() => void copy()}>
          {copied ? t('settings.copied') : t('settings.copy')}
        </button>
        <button data-tv-focus type="button" onClick={download}>
          {t('settings.download')}
        </button>
        <button data-tv-focus type="button" className="primary-button" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}

/** Import dialog: paste the exported text or pick the file. */
export function ConfigImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const importConfig = useMutation({ mutationFn: (value: string) => api.importConfig(value) });
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setText(await file.text());
  };
  const result = importConfig.data;
  return (
    <Dialog title={t('settings.importTitle')} onClose={onClose} className="config-transfer">
      <p className="dialog-subtitle">{t('settings.importHint')}</p>
      <textarea
        data-tv-focus
        value={text}
        rows={10}
        placeholder={t('settings.importPlaceholder')}
        onChange={(event) => setText(event.target.value)}
      />
      <label className="file-picker">
        <input type="file" accept="application/json,.json" onChange={(event) => void pick(event)} />
        <span>{t('settings.chooseFile')}</span>
      </label>
      {importConfig.error instanceof Error && (
        <p className="form-error">{importConfig.error.message}</p>
      )}
      {result && (
        <div className="notice">
          <p>
            {t('settings.importResult', {
              added: result.added.length,
              updated: result.updated.length,
            })}
          </p>
          {result.warnings.length > 0 && (
            <ul className="playlist-warnings">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="dialog-actions">
        <button data-tv-focus type="button" onClick={onClose}>
          {result ? t('common.close') : t('common.cancel')}
        </button>
        {!result && (
          <button
            data-tv-focus
            type="button"
            className="primary-button"
            disabled={importConfig.isPending || !text.trim()}
            onClick={() => importConfig.mutate(text)}
          >
            {importConfig.isPending ? t('common.loading') : t('settings.importConfig')}
          </button>
        )}
      </div>
    </Dialog>
  );
}

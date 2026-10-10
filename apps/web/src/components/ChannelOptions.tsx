import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import type { Channel } from '../types';
import { Dialog } from './Dialog';

export function ChannelOptions({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(channel.name);
  const [favorite, setFavorite] = useState(Boolean(channel.favorite));
  const [hidden, setHidden] = useState(Boolean(channel.hidden));
  const [epgSearch, setEpgSearch] = useState('');
  const [epgChoice, setEpgChoice] = useState<string>('auto');
  const epgChannels = useQuery({
    queryKey: ['epgChannels', channel.sourceId],
    queryFn: () => (channel.sourceId ? api.epgChannels(channel.sourceId) : []),
  });
  const autoKey = api.epgKeyFor(channel.id);
  const autoName = epgChannels.data?.find((item) => item.id === autoKey)?.name;
  const filtered = (epgChannels.data ?? [])
    .filter((item) => item.name.toLowerCase().includes(epgSearch.toLowerCase()))
    .slice(0, 40);
  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      await api.renameChannel(channel.id, trimmed && trimmed !== channel.name ? trimmed : null);
      if (favorite !== Boolean(channel.favorite)) await api.favorite(channel.id, favorite);
      if (hidden !== Boolean(channel.hidden)) await api.hideChannel(channel.id, hidden);
      if (epgChoice !== 'auto')
        await api.mapEpg(channel.id, epgChoice === 'none' ? null : epgChoice);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
      onClose();
    },
  });
  return (
    <Dialog title={t('options.title')} onClose={onClose} className="channel-options">
      <p className="dialog-subtitle">{t('options.group', { name: channel.groupName ?? '' })}</p>
      <label>
        {t('options.name')}
        <input
          data-tv-focus
          value={name}
          placeholder={t('options.namePlaceholder')}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="checkbox">
        <input
          data-tv-focus
          type="checkbox"
          checked={favorite}
          onChange={(event) => setFavorite(event.target.checked)}
        />
        {t('options.favorite')}
      </label>
      <label className="checkbox">
        <input
          data-tv-focus
          type="checkbox"
          checked={hidden}
          onChange={(event) => setHidden(event.target.checked)}
        />
        {t('options.hidden')}
      </label>
      <label>
        {t('options.epg')}
        <input
          data-tv-focus
          value={epgSearch}
          placeholder={t('options.epgSearch')}
          onChange={(event) => setEpgSearch(event.target.value)}
        />
        <select
          data-tv-focus
          size={6}
          value={epgChoice}
          onChange={(event) => setEpgChoice(event.target.value)}
        >
          <option value="auto">
            {t('options.epgAuto', { name: autoName ?? t('common.none') })}
          </option>
          <option value="none">{t('options.epgNone')}</option>
          {filtered.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="dialog-actions">
        <button data-tv-focus className="secondary-button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          data-tv-focus
          className="primary-button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('common.save')}
        </button>
      </div>
    </Dialog>
  );
}

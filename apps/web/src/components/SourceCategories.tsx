import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import type { Playlist } from '../types';
import { Dialog } from './Dialog';

/**
 * Picks the categories a list imports. The choice is saved on the source and
 * applied on every refresh, so the other categories are never downloaded.
 */
export function SourceCategories({
  playlist,
  onClose,
  onSaved,
}: {
  playlist: Playlist;
  onClose: () => void;
  onSaved: (channels: number) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [all, setAll] = useState(playlist.includedGroups === null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(playlist.includedGroups ?? playlist.availableGroups.map((g) => g.name)),
  );
  const [filter, setFilter] = useState('');
  const groups = playlist.availableGroups;
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? groups.filter((g) => g.name.toLowerCase().includes(needle)) : groups;
  }, [groups, filter]);
  const save = useMutation({
    mutationFn: () => api.setIncludedGroups(playlist.id, all ? null : [...selected]),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      onSaved(result.channelCount);
    },
  });
  const chosen = all ? groups : groups.filter((g) => selected.has(g.name));
  const channels = chosen.reduce((sum, g) => sum + g.channelCount, 0);
  const toggle = (name: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  const setVisible = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const group of visible) {
        if (on) next.add(group.name);
        else next.delete(group.name);
      }
      return next;
    });
  return (
    <Dialog
      title={t('lists.chooseCategories', { name: playlist.name })}
      onClose={onClose}
      className="group-manager source-categories"
    >
      <p className="dialog-subtitle">{t('lists.categoriesHint')}</p>
      {groups.length === 0 ? (
        <p className="dialog-subtitle">{t('lists.categoriesEmpty')}</p>
      ) : (
        <>
          <label className="checkbox">
            <input
              data-tv-focus
              type="checkbox"
              checked={all}
              onChange={(event) => setAll(event.target.checked)}
            />
            <span>{t('lists.categoriesAll')}</span>
          </label>
          <p className="categories-summary">
            {t('lists.categoriesSelected', {
              selected: chosen.length,
              total: groups.length,
              channels,
            })}
          </p>
          {!all && (
            <>
              <input
                data-tv-focus
                type="search"
                className="categories-filter"
                placeholder={t('lists.categoriesFilter')}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="categories-bulk">
                <button data-tv-focus type="button" onClick={() => setVisible(true)}>
                  {t('lists.checkVisible')}
                </button>
                <button data-tv-focus type="button" onClick={() => setVisible(false)}>
                  {t('lists.uncheckVisible')}
                </button>
              </div>
              <ul className="group-list">
                {visible.map((group) => (
                  <li key={group.name}>
                    <label className="checkbox">
                      <input
                        data-tv-focus
                        type="checkbox"
                        checked={selected.has(group.name)}
                        onChange={(event) => toggle(group.name, event.target.checked)}
                      />
                      <span>{group.name}</span>
                      <small>{group.channelCount}</small>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {save.error instanceof Error && <p className="form-error">{save.error.message}</p>}
      <div className="dialog-actions">
        <button data-tv-focus type="button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          data-tv-focus
          type="button"
          className="primary-button"
          disabled={save.isPending || groups.length === 0}
          onClick={() => save.mutate()}
        >
          {save.isPending ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </Dialog>
  );
}

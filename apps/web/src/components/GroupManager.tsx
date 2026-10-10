import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useT } from '../i18n';
import { Dialog } from './Dialog';

export function GroupManager({ onClose }: { onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ['groups', 'all'], queryFn: api.groups });
  const toggle = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => api.hideGroup(id, hidden),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
  return (
    <Dialog title={t('groups.title')} onClose={onClose} className="group-manager">
      <p className="dialog-subtitle">{t('groups.hint')}</p>
      <ul className="group-list">
        {groups.data?.map((group) => (
          <li key={group.id}>
            <label className="checkbox">
              <input
                data-tv-focus
                type="checkbox"
                checked={!group.hidden}
                onChange={(event) => toggle.mutate({ id: group.id, hidden: !event.target.checked })}
              />
              <span>{group.name}</span>
              <small>{group.channelCount}</small>
            </label>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button data-tv-focus className="primary-button" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}

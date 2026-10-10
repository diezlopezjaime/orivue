import { NavLink } from 'react-router-dom';
import { useT, type MessageKey } from '../i18n';
import { Icon } from './Icon';

const links: Array<{
  to: string;
  icon: 'live' | 'guide' | 'video' | 'lists' | 'settings';
  label: MessageKey;
}> = [
  { to: '/', icon: 'live', label: 'nav.live' },
  { to: '/guide', icon: 'guide', label: 'nav.guide' },
  { to: '/video', icon: 'video', label: 'nav.video' },
  { to: '/lists', icon: 'lists', label: 'nav.lists' },
  { to: '/settings', icon: 'settings', label: 'nav.settings' },
];

export function Sidebar() {
  const t = useT();
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="Orivue">
        <span className="brand-mark">
          <i />
          <i />
          <i />
        </span>
        <span>orivue</span>
      </div>
      <nav aria-label="Principal">
        {links.map((link) => (
          <NavLink
            data-tv-focus
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon name={link.icon} />
            <span>{t(link.label)}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className="status-dot" />
        {t('brand.local')}
      </div>
    </aside>
  );
}

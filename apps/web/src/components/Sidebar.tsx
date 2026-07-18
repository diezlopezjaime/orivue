import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';

const links = [
  { to: '/', icon: 'live' as const, label: 'En directo' },
  { to: '/guide', icon: 'guide' as const, label: 'Guía' },
  { to: '/lists', icon: 'lists' as const, label: 'Mis listas' },
];

export function Sidebar() {
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
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className="status-dot" />
        Servicio local
      </div>
    </aside>
  );
}

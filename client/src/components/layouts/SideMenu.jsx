import React, { useContext, useEffect, useState } from 'react';
import { LuSmartphone } from 'react-icons/lu';
import { UserContext } from '../../context/userContext';
import { useNavigate } from 'react-router-dom';
import { SIDE_MENU_DATA, SIDE_MENU_USER_DATA, SIDE_MENU_HEAD_DATA } from '../../utils/data';
import { hasModule } from '../../utils/roles';

const ROLE_BADGE = {
  admin: { label: 'Admin', className: 'chip chip-signal' },
  head: { label: 'Head of Department', className: 'chip chip-done' },
};

const SideMenu = ({ activeMenu, onNavigate, variant = 'rail' }) => {
  const isDrawer = variant === 'drawer';
  const { user, clearUser } = useContext(UserContext);
  const [sideMenuData, setSideMenuData] = useState([]);
  const navigate = useNavigate();

  const handleClick = (route) => {
    if (route === '/logout' || route === 'logout') {
      handleLogout();
      return;
    }
    navigate(route, { viewTransition: true });
    onNavigate?.();
  };

  const handleLogout = () => {
    localStorage.clear();
    clearUser();
    navigate('/login');
  };

  useEffect(() => {
    if (user) {
      const menuByRole = {
        admin: SIDE_MENU_DATA,
        head: SIDE_MENU_HEAD_DATA,
      };
      // An untagged entry always shows; a tagged one needs its module, so a
      // department that grants nothing simply has no Sales or Leads link.
      const menu = menuByRole[user?.role] || SIDE_MENU_USER_DATA;
      setSideMenuData(menu.filter((item) => !item.module || hasModule(user, item.module)));
    }
  }, [user]);

  const badge = ROLE_BADGE[user?.role];

  return (
    <nav
      aria-label="Main"
      /* As a drawer it sits over page content, so it is opaque: its own
         backdrop-filter cannot sample the page through the wrapper's transform,
         and a translucent rail there leaves the content legible behind the menu. */
      className={`vt-rail w-64 h-[calc(100vh-69px)] z-20 border-y-0 border-l-0 rounded-none flex flex-col ${
        isDrawer
          ? 'bg-void border-r border-white/10'
          : 'sticky top-[69px] panel-sunken backdrop-blur-xl'
      }`}
    >
      <div className="flex flex-col items-center px-6 pt-8 pb-6">
        <div className="relative">
          {/* The avatar sits in its own well, lit from above like everything else. */}
          <div className="absolute -inset-1.5 rounded-full bg-gradient-to-b from-ice/30 to-transparent blur-[2px]" />
          {user?.profileImageUrl ? (
            <img
              src={user.profileImageUrl}
              alt=""
              className="relative w-20 h-20 rounded-full object-cover border border-white/15"
            />
          ) : (
            <div className="relative w-20 h-20 rounded-full grid place-items-center bg-deck border border-white/10 font-display text-2xl text-ice">
              {(user?.name || '?').trim().charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {badge && <span className={`${badge.className} mt-4`}>{badge.label}</span>}

        <h5 className="font-display text-beam mt-3 text-center leading-tight">{user?.name || ''}</h5>
        <p className="text-dusk text-xs mt-1 text-center break-all">{user?.email || ''}</p>

        {/* A missing number means no WhatsApp alerts, so it reads as something
            to fix rather than as another line of profile text. */}
        {user?.phone ? (
          <p className="text-dusk text-xs mt-1 text-center num">+{user.phone}</p>
        ) : (
          <button
            type="button"
            onClick={() => handleClick('/profile')}
            className="chip chip-signal mt-2 cursor-pointer hover:brightness-125 transition-[filter]"
          >
            <LuSmartphone /> Add your number
          </button>
        )}
      </div>

      <div className="h-px mx-6 bg-gradient-to-r from-transparent via-white/12 to-transparent" />

      <ul className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {sideMenuData.map((item) => {
          const current = activeMenu === item.label;
          return (
            <li key={item.id}>
              <button
                aria-current={current ? 'page' : undefined}
                onClick={() => handleClick(item.path)}
                className={`group relative w-full flex items-center gap-3.5 text-sm rounded-lg py-2.5 px-4 cursor-pointer transition-colors duration-200 ${
                  current ? 'is-current' : 'text-mist hover:text-beam hover:bg-white/5'
                }`}
              >
                {/* The current item is marked by light, not by a filled block. */}
                {current && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r bg-signal shadow-[0_0_12px_2px_rgba(255,176,32,0.6)]" />
                )}
                <item.icon
                  className={`text-lg shrink-0 transition-transform duration-200 ${
                    current ? '' : 'group-hover:scale-110'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default SideMenu;

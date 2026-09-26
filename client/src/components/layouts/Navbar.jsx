import React, { useContext, useEffect, useState } from 'react';
import { HiOutlineMenu, HiOutlineX } from 'react-icons/hi';
import SideMenu from './SideMenu';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';
import { UserContext } from '../../context/userContext';

const Navbar = ({ activeMenu }) => {
    const [openSideMenu, setOpenSideMenu] = useState(false);
    const { user } = useContext(UserContext);

    // A drawer that survives Escape and a resize back to desktop is a drawer
    // nobody gets stuck behind.
    useEffect(() => {
        if (!openSideMenu) return undefined;
        const onKey = (e) => e.key === 'Escape' && setOpenSideMenu(false);
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [openSideMenu]);

    return (
        <header className="vt-bar sticky top-0 z-40 flex items-center gap-4 px-5 md:px-7 py-4 bg-void/70 backdrop-blur-xl border-b border-white/8">
            <button
                className="min-[1081px]:hidden text-mist hover:text-beam transition-colors cursor-pointer"
                aria-label={openSideMenu ? 'Close menu' : 'Open menu'}
                aria-expanded={openSideMenu}
                onClick={() => setOpenSideMenu((v) => !v)}
            >
                {openSideMenu ? <HiOutlineX className="text-2xl" /> : <HiOutlineMenu className="text-2xl" />}
            </button>

            <div className="flex items-center gap-2.5">
                {/* A lit aperture - the light source the whole interface is built around. */}
                <span className="relative grid place-items-center w-7 h-7 rounded-lg bg-deck border border-white/10">
                    <span className="w-2.5 h-2.5 rounded-full bg-signal shadow-[0_0_14px_3px_rgba(255,176,32,0.65)]" />
                </span>
                <h1 className="font-display text-base font-semibold text-beam tracking-tight">Task Manager</h1>
            </div>

            <div className="ml-auto flex items-center gap-1">
                <ThemeToggle />
                {user && <NotificationBell />}
            </div>

            {/* Mobile drawer */}
            {openSideMenu && (
                <>
                    <button
                        className="enter-fade fixed inset-0 top-[69px] z-30 bg-void/70 backdrop-blur-sm min-[1081px]:hidden cursor-default"
                        aria-label="Close menu"
                        tabIndex={-1}
                        onClick={() => setOpenSideMenu(false)}
                    />
                    <div className="enter-drop fixed top-[69px] left-0 z-40 min-[1081px]:hidden origin-top-left shadow-[12px_0_40px_-12px_rgba(0,0,0,0.9)]">
                        <SideMenu
                            variant="drawer"
                            activeMenu={activeMenu}
                            onNavigate={() => setOpenSideMenu(false)}
                        />
                    </div>
                </>
            )}
        </header>
    );
};

export default Navbar;

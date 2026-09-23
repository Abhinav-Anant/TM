import React, { useState } from 'react';
import { LuMoon, LuSun } from 'react-icons/lu';

// index.html applies the saved theme before first paint; this only flips it.
const ThemeToggle = () => {
    const [theme, setTheme] = useState(
        () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
    );
    const next = theme === 'light' ? 'dark' : 'light';

    const toggle = () => {
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('theme', next); } catch { /* private mode: lasts this page only */ }
        setTheme(next);
    };

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${next} theme`}
            title={`Switch to ${next} theme`}
            className="grid place-items-center w-10 h-10 rounded-lg text-mist hover:text-beam hover:bg-white/6 transition-colors cursor-pointer"
        >
            {theme === 'light' ? <LuMoon className="text-xl" /> : <LuSun className="text-xl" />}
        </button>
    );
};

export default ThemeToggle;

import React, { useEffect, useRef, useState } from 'react';
import { LuChevronDown, LuCheck } from 'react-icons/lu';

const SelectDropdown = ({ options = [], value, onChange, placeholder }) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapRef = useRef(null);

    // Close on outside click and on Escape - a dropdown you can only close by
    // picking something is a trap.
    useEffect(() => {
        if (!isOpen) return undefined;
        const onDown = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setIsOpen(false);
        };
        const onKey = (e) => e.key === 'Escape' && setIsOpen(false);
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [isOpen]);

    const selected = options.find((opt) => opt.value === value);

    return (
        <div className="relative w-full mt-2" ref={wrapRef}>
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                className="field flex justify-between items-center gap-2 text-left cursor-pointer"
                onClick={() => setIsOpen((v) => !v)}
            >
                <span className={selected ? 'text-beam' : 'text-dusk'}>
                    {selected?.label || placeholder}
                </span>
                <LuChevronDown
                    className={`text-mist shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <ul
                    role="listbox"
                    className="enter-drop absolute z-30 w-full panel panel-raised panel-blur mt-2 p-1 overflow-hidden"
                >
                    {options.map((option) => {
                        const current = option.value === value;
                        return (
                            <li key={option.value}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={current}
                                    onClick={() => { onChange(option.value); setIsOpen(false); }}
                                    className={`w-full flex items-center justify-between gap-2 text-left text-sm px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                                        current ? 'text-signal bg-signal/10' : 'text-mist hover:text-beam hover:bg-white/6'
                                    }`}
                                >
                                    {option.label}
                                    {current && <LuCheck className="shrink-0" />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default SelectDropdown;

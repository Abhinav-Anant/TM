import React from 'react';

const TaskStatusTab = ({ tabs, activeTab, setActiveTab }) => {
    return (
        // Four tabs do not fit a phone. Scroll the strip rather than letting the
        // page clip it - body has overflow-x hidden, so a clipped tab would be
        // unreachable, not just off-screen.
        <div className="max-w-full overflow-x-auto no-scrollbar -mx-1 px-1">
        <div className="flex items-center gap-1 p-1 rounded-xl panel-sunken w-max" role="tablist">
            {tabs.map((tab) => {
                const current = activeTab === tab.label;
                return (
                    <button
                        key={tab.label}
                        role="tab"
                        aria-selected={current}
                        onClick={() => setActiveTab(tab.label)}
                        className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors duration-200 ${
                            current ? 'text-void' : 'text-mist hover:text-beam'
                        }`}
                    >
                        {/* The lit pill is the selection, so no underline is needed. */}
                        {current && (
                            <span className="absolute inset-0 rounded-lg bg-signal shadow-[0_6px_20px_-8px_rgba(255,176,32,0.9)]" />
                        )}
                        <span className="relative">{tab.label}</span>
                        <span
                            className={`relative num text-[11px] px-1.5 py-0.5 rounded ${
                                current ? 'bg-void/20 text-void' : 'bg-white/8 text-mist'
                            }`}
                        >
                            {tab.count}
                        </span>
                    </button>
                );
            })}
        </div>
        </div>
    );
};

export default TaskStatusTab;

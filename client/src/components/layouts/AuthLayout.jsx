import React from 'react';
import ThemeToggle from './ThemeToggle';

/**
 * The hero is the product, not a picture of one: a slice of work suspended in
 * depth, using the same glass the rest of the app is built from.
 */
const DECK = [
  { title: 'Q3 rollout plan', status: 'In Progress', tone: 'chip-active', progress: 68, depth: 0 },
  { title: 'Vendor contract review', status: 'Pending', tone: 'chip-pending', progress: 20, depth: 1 },
  { title: 'Onboarding checklist', status: 'Completed', tone: 'chip-done', progress: 100, depth: 2 },
  { title: 'Server migration', status: 'Overdue', tone: 'chip-alert', progress: 45, depth: 3 },
];

const AuthLayout = ({ children }) => {
  return (
    <div className="min-h-screen flex">
      <div className="w-full md:w-[55%] lg:w-[50%] flex flex-col px-6 sm:px-12 lg:px-20 py-8">
        <div className="flex items-center gap-2.5">
          <span className="relative grid place-items-center w-7 h-7 rounded-lg bg-deck border border-white/10">
            <span className="w-2.5 h-2.5 rounded-full bg-signal shadow-[0_0_14px_3px_rgba(255,176,32,0.65)]" />
          </span>
          <span className="font-display text-base font-semibold text-beam">Task Manager</span>
          <div className="ml-auto"><ThemeToggle /></div>
        </div>

        <div className="flex-1 flex flex-col justify-center py-10">{children}</div>
      </div>

      <div className="hidden md:flex md:w-[45%] lg:w-[50%] relative items-center justify-center overflow-hidden border-l border-white/6">
        <div
          className="relative w-[330px] h-[300px] -translate-y-8"
          style={{ perspective: '1400px' }}
          aria-hidden="true"
        >
          <div className="absolute inset-0 auth-deck">
            {DECK.map((task, i) => (
              <article
                key={task.title}
                className="panel absolute left-0 right-0 p-5 auth-card"
                style={{
                  '--i': i,
                  top: `${i * 68}px`,
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-sm text-beam truncate">{task.title}</h3>
                  <span className={`chip ${task.tone} shrink-0`}>{task.status}</span>
                </div>

                <div className="mt-4 h-1 rounded-full bg-white/8 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-ice to-signal auth-fill"
                    style={{ '--to': `${task.progress}%` }}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;

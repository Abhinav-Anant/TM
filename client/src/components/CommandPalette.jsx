import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuSearch, LuListChecks, LuFolderKanban, LuUser, LuBuilding2 } from 'react-icons/lu';
import Modal from './layouts/Modal';
import { UserContext } from '../context/userContext';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { basePathFor, canAssignTasks } from '../utils/roles';

const KINDS = [
  ['tasks', 'Tasks', LuListChecks],
  ['projects', 'Projects', LuFolderKanban],
  ['people', 'People', LuUser],
  ['departments', 'Departments', LuBuilding2],
];

/**
 * Global search, opened with Ctrl/Cmd+K (or the navbar button). One box over tasks,
 * projects, people and departments; the server scopes every kind to what you can open.
 */
const SearchButton = () => {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [active, setActive] = useState(0);
  const latest = useRef(0);
  const inputRef = useRef(null);
  const base = basePathFor(user);
  const manager = canAssignTasks(user);

  const close = useCallback(() => { setOpen(false); setQuery(''); setResults(null); setActive(0); }, []);

  // <dialog>.showModal() focuses its first button (the close X); put the cursor in the box instead.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return undefined; }
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const { data } = await axiosInstance.get(API_PATHS.SEARCH, { params: { q: query.trim() } });
        // A slow earlier request must not overwrite a newer one.
        if (ticket === latest.current) { setResults(data); setActive(0); }
      } catch {
        if (ticket === latest.current) setResults({ tasks: [], projects: [], people: [], departments: [] });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Flat list in display order, so arrow keys walk across the groups.
  const flat = [];
  if (results) {
    results.tasks.forEach((t) => flat.push({ kind: 'tasks', key: t._id, label: t.title, sub: t.status, go: `/user/task-details/${t._id}` }));
    results.projects.forEach((p) => flat.push({ kind: 'projects', key: p._id, label: p.name, sub: p.status, go: `/projects/${p._id}` }));
    results.people.forEach((u) => flat.push({
      kind: 'people', key: u._id, label: u.name, sub: u.email,
      go: manager ? `${base}/tasks?assignee=${u._id}&name=${encodeURIComponent(u.name)}` : null,
    }));
    results.departments.forEach((d) => flat.push({
      kind: 'departments', key: d._id, label: d.name, sub: 'Department',
      go: user?.role === 'admin' ? '/admin/departments' : manager ? `${base}/users` : null,
    }));
  }

  const choose = (item) => {
    if (!item?.go) return;
    close();
    navigate(item.go, { viewTransition: true });
  };

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[active]); }
  };

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)} aria-label="Search (Ctrl+K)"
        className="flex items-center gap-2 px-2.5 h-9 rounded-lg text-mist hover:text-beam hover:bg-white/8 transition-colors cursor-pointer"
      >
        <LuSearch className="text-base" />
        <kbd className="hidden md:inline text-[10px] text-dusk border border-white/12 rounded px-1.5 py-0.5">Ctrl K</kbd>
      </button>

      <Modal isOpen={open} onClose={close} title="Search">
        <div className="p-4">
          <div className="field flex items-center gap-2 py-2">
            <LuSearch className="text-dusk shrink-0" />
            <input
              ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onInputKey}
              placeholder="Search tasks, projects, people, departments"
              aria-label="Search" role="combobox" aria-expanded={flat.length > 0} aria-controls="search-results"
              className="w-full text-sm text-beam placeholder:text-dusk outline-none bg-transparent"
            />
          </div>

          <div id="search-results" role="listbox" className="mt-3 max-h-[50vh] overflow-y-auto">
            {query.trim().length < 2 && <p className="text-sm text-dusk px-1 py-3">Type at least two letters.</p>}
            {results && flat.length === 0 && <p className="text-sm text-dusk px-1 py-3">Nothing found for “{query.trim()}”.</p>}
            {KINDS.map(([kind, title, Icon]) => {
              const rows = flat.filter((f) => f.kind === kind);
              if (!rows.length) return null;
              return (
                <div key={kind} className="mb-2">
                  <p className="text-[11px] uppercase tracking-wide text-dusk px-2 py-1">{title}</p>
                  {rows.map((item) => {
                    const index = flat.indexOf(item);
                    return (
                      <button
                        key={item.key} type="button" role="option" aria-selected={index === active} disabled={!item.go}
                        onMouseEnter={() => setActive(index)} onClick={() => choose(item)}
                        className={`w-full flex items-center gap-3 text-left px-2 py-2 rounded-lg ${item.go ? 'cursor-pointer' : 'cursor-default'} ${index === active ? 'bg-white/8' : ''}`}
                      >
                        {React.createElement(Icon, { className: "text-dusk shrink-0" })}
                        <span className="grow min-w-0 truncate text-sm text-beam">{item.label}</span>
                        <span className="text-xs text-dusk truncate max-w-[40%]">{item.sub}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
};

export default SearchButton;

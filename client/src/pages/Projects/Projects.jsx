import React, { useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import { LuPlus, LuFolderKanban, LuSearch } from 'react-icons/lu';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import Progress from '../../components/layouts/Progress';
import Modal from '../../components/layouts/Modal';
import Pager from '../../components/Pager';
import ProjectForm from '../../components/ProjectForm';
import { UserContext } from '../../context/userContext';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { PROJECT_STATUS_DATA, projectStatusChip, priorityChip } from '../../utils/data';
import { canAssignTasks } from '../../utils/roles';

export const ProjectStats = ({ stats }) => (
  <dl className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
    {[
      ['Total', stats.total, 'text-beam'],
      ['Done', stats.completed, 'text-done'],
      ['In progress', stats.inProgress, 'text-active'],
      ['Overdue', stats.overdue, stats.overdue ? 'text-alert' : 'text-beam'],
      ['Blocked', stats.blocked, stats.blocked ? 'text-alert' : 'text-beam'],
      ['Due soon', stats.dueSoon, stats.dueSoon ? 'text-signal' : 'text-beam'],
    ].map(([label, value, tone]) => (
      <div key={label}>
        <dd className={`font-display text-xl num ${tone}`}>{value}</dd>
        <dt className="text-[11px] text-dusk">{label}</dt>
      </div>
    ))}
  </dl>
);

const Projects = () => {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.get(API_PATHS.PROJECTS.GET_ALL, { params: { status, search: query, page } });
      setProjects(data.projects || []);
      setPagination(data.pagination);
    } catch {
      toast.error('Could not load projects.');
    } finally {
      setLoading(false);
    }
  }, [status, query, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, query]);
  // Debounce typing so each keystroke is not a request.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <DashboardLayout activeMenu="Projects">
      <div className="py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-beam">Projects</h2>
          {canAssignTasks(user) && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}><LuPlus /> New project</button>
          )}
        </div>

        <div className="panel p-3 mt-4 flex flex-wrap items-center gap-2">
          <div className="field flex-1 min-w-[200px] flex items-center gap-2 py-2">
            <LuSearch className="text-dusk shrink-0" />
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects" aria-label="Search projects"
              className="w-full text-sm text-beam placeholder:text-dusk outline-none bg-transparent"
            />
          </div>
          <select className="field py-2 w-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {PROJECT_STATUS_DATA.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-44" />)}
          </div>
        ) : projects.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            {projects.map((p) => (
              <article
                key={p._id}
                className="panel p-5 cursor-pointer space-y-4"
                role="link" tabIndex={0}
                onClick={() => navigate(`/projects/${p._id}`, { viewTransition: true })}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/projects/${p._id}`); }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-display text-lg text-beam leading-snug">{p.name}</h3>
                  <div className="flex gap-2">
                    <span className={`chip ${projectStatusChip(p.status)}`}>{p.status}</span>
                    <span className={`chip ${priorityChip(p.priority)}`}>{p.priority}</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between text-xs mb-2">
                    <span className="text-dusk">{p.manager ? `Managed by ${p.manager.name}` : 'No manager'}{p.department ? ` · ${p.department.name}` : ''}</span>
                    <span className="text-mist num">{p.stats.progress}%</span>
                  </div>
                  <Progress progress={p.stats.progress} status={p.status === 'Completed' ? 'Completed' : 'In Progress'} />
                </div>
                <ProjectStats stats={p.stats} />
                {p.dueDate && <p className="text-xs text-dusk num">Due {moment(p.dueDate).format('D MMM YYYY')}</p>}
              </article>
            ))}
          </div>
        ) : (
          <div className="panel p-12 mt-4 text-center">
            <LuFolderKanban className="text-3xl text-dusk mx-auto" />
            <p className="text-beam mt-4">{query || status ? 'No projects match.' : 'No projects yet.'}</p>
            {canAssignTasks(user) && !query && !status && (
              <button className="btn btn-primary mt-4" onClick={() => setCreating(true)}><LuPlus /> Create the first project</button>
            )}
          </div>
        )}

        <Pager page={page} pages={pagination.pages} total={pagination.total} onChange={setPage} noun="projects" />
      </div>

      <Modal isOpen={creating} onClose={() => setCreating(false)} title="New project">
        {creating && <ProjectForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      </Modal>
    </DashboardLayout>
  );
};

export default Projects;

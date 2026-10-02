import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuInbox, LuPlus } from 'react-icons/lu';
import DashboardLayout from '../components/layouts/DashboardLayout';
import TaskCard from '../components/Cards/TaskCard';
import Pager from '../components/Pager';
import { UserContext } from '../context/userContext';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { PRIORITY_DATA } from '../utils/data';
import { canAssignTasks } from '../utils/roles';

const PAGE_SIZE = 24;
const TABS = ['All', 'Today', 'Upcoming', 'Overdue', 'Completed'];
const COUNT_KEY = { Today: 'dueToday', Upcoming: 'upcoming', Overdue: 'overdue' };

/** Each tab is an ordinary filter over the task list; "today" is the browser's today. */
const tabParams = (tab) => {
  const start = moment().startOf('day');
  const end = moment(start).add(1, 'day');
  const before = (m) => moment(m).subtract(1, 'ms').toISOString();
  switch (tab) {
    case 'Today': return { open: 'true', dueAfter: start.toISOString(), dueBefore: before(end) };
    case 'Upcoming': return { open: 'true', dueAfter: end.toISOString() };
    case 'Overdue': return { open: 'true', dueBefore: before(start) };
    case 'Completed': return { status: 'Completed' };
    default: return {};
  }
};

const selectClass = 'field py-2 w-auto';

const MyWork = () => {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'All';

  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({});
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ project: '', priority: '', tag: '' });
  const [projects, setProjects] = useState([]);
  const [tags, setTags] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, dash] = await Promise.all([
        axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, {
          params: { mine: 'true', sortBy: 'dueDate', sortOrder: 'asc', page, limit: PAGE_SIZE, ...tabParams(tab), ...filters },
        }),
        axiosInstance.get(API_PATHS.TASKS.MY_DASHBOARD, { params: { tzOffset: new Date().getTimezoneOffset() } }),
      ]);
      setTasks(list.data.tasks || []);
      setPagination(list.data.pagination);
      setCounts(dash.data);
    } catch {
      toast.error('Could not load your work.');
    } finally {
      setLoading(false);
    }
  }, [tab, filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, filters]);
  useEffect(() => {
    axiosInstance.get(API_PATHS.PROJECTS.GET_ALL, { params: { limit: 100 } }).then(({ data }) => setProjects(data.projects || [])).catch(() => {});
    axiosInstance.get(API_PATHS.TASKS.GET_TAGS).then(({ data }) => setTags(data.tags || [])).catch(() => {});
  }, []);

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <DashboardLayout activeMenu="My Work">
      <div className="py-6">
        <h2 className="font-display text-2xl text-beam">My work</h2>

        <QuickAdd user={user} onAdded={load} />

        <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
          <div className="max-w-full overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1 p-1 rounded-xl panel-sunken w-max" role="tablist">
              {TABS.map((name) => (
                <button
                  key={name} role="tab" aria-selected={tab === name}
                  onClick={() => setSearchParams(name === 'All' ? {} : { tab: name })}
                  className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${tab === name ? 'text-ink' : 'text-mist hover:text-beam'}`}
                >
                  {tab === name && <span className="absolute inset-0 rounded-lg bg-signal" />}
                  <span className="relative">{name}</span>
                  {COUNT_KEY[name] && (
                    <span className={`relative num text-[11px] px-1.5 py-0.5 rounded ${tab === name ? 'bg-ink/20 text-ink' : 'bg-white/8 text-mist'}`}>
                      {counts[COUNT_KEY[name]] ?? 0}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <select className={selectClass} aria-label="Filter by project" value={filters.project} onChange={(e) => setFilter('project', e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
            <select className={selectClass} aria-label="Filter by priority" value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
              <option value="">Any priority</option>
              {PRIORITY_DATA.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select className={selectClass} aria-label="Filter by tag" value={filters.tag} onChange={(e) => setFilter('tag', e.target.value)}>
              <option value="">All tags</option>
              {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-64" />)}
          </div>
        ) : tasks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            {tasks.map((task) => (
              <TaskCard
                key={task._id}
                title={task.title} description={task.description} priority={task.priority} status={task.status}
                category={task.category} progress={task.progress} dueDate={task.dueDate}
                assignedTo={(task.assignedTo || []).map((a) => a.profileImageUrl)}
                attachmentCount={task.attachments?.length || 0} commentCount={task.comments?.length || 0}
                completedTodoCount={task.completedTodoCount || 0} todoChecklist={task.todoChecklist || []}
                tags={task.tags} waitingFor={task.waitingFor}
                onClick={() => navigate(`/user/task-details/${task._id}`, { viewTransition: true })}
              />
            ))}
          </div>
        ) : (
          <div className="panel p-12 mt-4 text-center">
            <LuInbox className="text-3xl text-dusk mx-auto" />
            <p className="text-beam mt-4">{tab === 'All' ? 'Nothing assigned to you yet.' : `Nothing in ${tab.toLowerCase()}.`}</p>
            <p className="text-sm text-mist mt-1">Add a task above, or clear the filters.</p>
          </div>
        )}

        <Pager page={page} pages={pagination.pages} total={pagination.total} onChange={setPage} />
      </div>
    </DashboardLayout>
  );
};

/** Task, assignee, due date, priority - nothing else. Everything more is edited later. */
const QuickAdd = ({ user, onAdded }) => {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState(user?._id || '');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [people, setPeople] = useState([]);
  const [saving, setSaving] = useState(false);
  const mayPickPeople = canAssignTasks(user);

  useEffect(() => {
    if (!mayPickPeople) return;
    axiosInstance.get(API_PATHS.USERS.GET_ALL_USERS).then(({ data }) => setPeople(data || [])).catch(() => {});
  }, [mayPickPeople]);

  const options = useMemo(() => {
    const others = people.filter((p) => p._id !== user?._id);
    return [{ _id: user?._id, name: 'Me' }, ...others];
  }, [people, user]);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await axiosInstance.post(API_PATHS.TASKS.CREATE_TASK, {
        title, priority, assignedTo: [assignee || user._id],
        dueDate: due ? new Date(due).toISOString() : null,
      });
      setTitle(''); setDue('');
      toast.success('Task added');
      onAdded();
    } catch (error) {
      toast.error(error.response?.data?.message || 'That did not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel p-3 mt-4 flex flex-wrap items-center gap-2" aria-label="Quick add task">
      <input
        className="field flex-1 min-w-[220px] py-2" placeholder="Add a task and press Enter"
        aria-label="Task" value={title} onChange={(e) => setTitle(e.target.value)}
      />
      {mayPickPeople && (
        <select className="field w-auto py-2" aria-label="Assign to" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          {options.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
      )}
      <input type="date" className="field w-auto py-2" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
      <select className="field w-auto py-2" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
        {PRIORITY_DATA.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}><LuPlus /> Add</button>
    </form>
  );
};

export default MyWork;

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuBan, LuCalendar, LuTriangleAlert } from 'react-icons/lu';
import DashboardLayout from '../components/layouts/DashboardLayout';
import AvatarGroup from '../components/layouts/AvatarGroup';
import TaskFilters, { EMPTY_FILTERS, toQueryParams } from '../components/TaskFilters';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { priorityChip, statusFill } from '../utils/data';

const COLUMNS = ['To Do', 'In Progress', 'Blocked', 'In Review', 'Completed'];
const STEP = 30;
// A card can be dropped anywhere except In Review: that column is the server's answer to
// "Completed" on a task that needs sign-off, never something a person sets by hand.
const DROPPABLE = COLUMNS.filter((c) => c !== 'In Review');

const empty = () => Object.fromEntries(COLUMNS.map((c) => [c, { tasks: [], total: 0 }]));

const Board = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [columns, setColumns] = useState(empty);
  const [limits, setLimits] = useState(() => Object.fromEntries(COLUMNS.map((c) => [c, STEP])));
  const [loading, setLoading] = useState(true);
  const [over, setOver] = useState(null);
  const [tags, setTags] = useState([]);
  const [projects, setProjects] = useState([]);

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(COLUMNS.map((column) => axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, {
        params: {
          ...toQueryParams(filters, column),
          // Oldest-due first; the Completed column shows the latest finish first.
          sortBy: column === 'Completed' ? 'completedAt' : 'dueDate',
          sortOrder: column === 'Completed' ? 'desc' : 'asc',
          limit: limits[column],
        },
      })));
      setColumns(Object.fromEntries(COLUMNS.map((c, i) => [c, { tasks: results[i].data.tasks || [], total: results[i].data.pagination?.total || 0 }])));
    } catch {
      toast.error('Could not load the board.');
    } finally {
      setLoading(false);
    }
  }, [filters, limits]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axiosInstance.get(API_PATHS.TASKS.GET_TAGS).then(({ data }) => setTags(data.tags || [])).catch(() => {});
    axiosInstance.get(API_PATHS.PROJECTS.GET_ALL, { params: { limit: 100 } }).then(({ data }) => setProjects(data.projects || [])).catch(() => {});
  }, []);

  const move = async (taskId, target) => {
    const from = COLUMNS.find((c) => columns[c].tasks.some((t) => t._id === taskId));
    if (!from || from === target) return;
    if (!DROPPABLE.includes(target)) {
      toast('Drop it on Completed to submit for review.', { icon: 'ℹ️' });
      return;
    }

    // Optimistic: the card jumps now, and snaps back if the server says no.
    const task = columns[from].tasks.find((t) => t._id === taskId);
    setColumns((prev) => ({
      ...prev,
      [from]: { tasks: prev[from].tasks.filter((t) => t._id !== taskId), total: prev[from].total - 1 },
      [target]: { tasks: [{ ...task, status: target }, ...prev[target].tasks], total: prev[target].total + 1 },
    }));
    try {
      const { data } = await axiosInstance.put(API_PATHS.TASKS.UPDATE_TASK_STATUS(taskId), { status: target });
      if (data.updatedTask?.status === 'In Review') toast.success('Submitted for review');
    } catch (error) {
      toast.error(error.response?.data?.message || 'That move was not allowed.');
    }
    load(); // the server decides where the card really belongs (e.g. Completed -> In Review)
  };

  return (
    <DashboardLayout activeMenu="Board">
      <div className="py-6">
        <h2 className="font-display text-2xl text-beam">Board</h2>
        <TaskFilters filters={filters} setFilters={setFilters} tags={tags} projects={projects} />

        <div className="mt-4 flex gap-4 overflow-x-auto pb-4 snap-x" aria-label="Task board">
          {COLUMNS.map((column) => {
            const { tasks, total } = columns[column];
            const droppable = DROPPABLE.includes(column);
            return (
              <section
                key={column}
                aria-label={`${column}, ${total} tasks`}
                className={`panel-sunken rounded-2xl p-3 w-[290px] shrink-0 snap-start transition-colors ${over === column && droppable ? 'ring-2 ring-signal/60 bg-signal/5' : ''}`}
                onDragOver={(e) => { e.preventDefault(); if (over !== column) setOver(column); }}
                onDragLeave={() => setOver((c) => (c === column ? null : c))}
                onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData('text/plain'), column); }}
              >
                <header className="flex items-center justify-between px-1 pb-3">
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-mist">
                    <span className={`w-2 h-2 rounded-full ${statusFill(column)}`} /> {column}
                  </h3>
                  <span className="text-xs text-dusk num">{total}</span>
                </header>

                <div className="space-y-2.5 min-h-[80px]">
                  {loading && [0, 1].map((i) => <div key={i} className="skeleton h-24" />)}
                  {!loading && tasks.map((task) => (
                    <Card
                      key={task._id} task={task} column={column}
                      onOpen={() => navigate(`/user/task-details/${task._id}`, { viewTransition: true })}
                      onMove={(target) => move(task._id, target)}
                    />
                  ))}
                  {!loading && tasks.length === 0 && <p className="text-xs text-dusk px-1 py-4 text-center">Nothing here.</p>}
                </div>

                {tasks.length < total && (
                  <button type="button" className="btn btn-sm w-full mt-3" onClick={() => setLimits((l) => ({ ...l, [column]: l[column] + STEP }))}>
                    Show more ({total - tasks.length})
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
};

const Card = ({ task, column, onOpen, onMove }) => {
  const overdue = !['Completed', 'Cancelled'].includes(task.status) && task.dueDate && moment(task.dueDate).isBefore(moment(), 'day');
  return (
    <article
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', task._id); e.dataTransfer.effectAllowed = 'move'; }}
      className="panel p-3 cursor-grab active:cursor-grabbing space-y-2"
    >
      <button type="button" className="text-left text-sm font-medium text-beam hover:text-signal cursor-pointer line-clamp-2" onClick={onOpen}>
        {task.title}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`chip ${priorityChip(task.priority)}`}>{task.priority}</span>
        {task.project?.name && <span className="chip chip-mist truncate max-w-[140px]">{task.project.name}</span>}
        {(task.tags || []).slice(0, 2).map((t) => <span key={t} className="text-[11px] text-dusk">#{t}</span>)}
      </div>
      {task.waitingFor?.length > 0 && (
        <p className="text-[11px] text-alert flex items-center gap-1"><LuBan className="shrink-0" /> Waiting for {task.waitingFor.join(', ')}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1 text-[11px] ${overdue ? 'text-alert' : 'text-dusk'}`}>
          {overdue ? <LuTriangleAlert /> : <LuCalendar />}
          <span className="num">{task.dueDate ? moment(task.dueDate).format('D MMM') : 'No date'}</span>
        </span>
        <AvatarGroup avatars={(task.assignedTo || []).map((a) => a.profileImageUrl)} maxVisible={3} />
      </div>
      {/* Keyboard and touch users cannot drag; this does the same thing. */}
      <label className="block">
        <span className="sr-only">Move {task.title} to</span>
        <select className="field py-1 text-xs" value={column} onChange={(e) => onMove(e.target.value)}>
          {COLUMNS.map((c) => <option key={c} value={c} disabled={c === 'In Review' && column !== 'In Review'}>{c}</option>)}
        </select>
      </label>
    </article>
  );
};

export default Board;

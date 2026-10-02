import React, { useEffect, useState } from 'react';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuPlus, LuX, LuLink, LuBan, LuEye, LuEyeOff, LuCircleCheck, LuCircle, LuLoaderCircle } from 'react-icons/lu';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { statusChip } from '../utils/data';

const errorOf = (error) => error.response?.data?.message || "That did not go through.";

/** "#website" chips. Read-only; tags are edited on the task form. */
export const TagChips = ({ tags = [] }) => (
  tags.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => <span key={tag} className="chip chip-mist">#{tag}</span>)}
    </div>
  )
);

/** Shown only while something unfinished stands in the way. */
export const WaitingBanner = ({ waitingFor = [] }) => (
  waitingFor.length > 0 && (
    <div role="status" className="chip chip-alert w-full justify-start gap-2 mt-4">
      <LuBan className="shrink-0" />
      <span>Blocked. Waiting for {waitingFor.join(", ")}</span>
    </div>
  )
);

export const WatchButton = ({ taskId, isWatching, onChange }) => {
  const toggle = async () => {
    try {
      const { data } = await axiosInstance.put(API_PATHS.TASKS.WATCH(taskId), { watching: !isWatching });
      onChange(data.isWatching);
    } catch (error) {
      toast.error(errorOf(error));
    }
  };
  return (
    <button type="button" className="btn btn-sm" onClick={toggle}>
      {isWatching ? <LuEyeOff /> : <LuEye />} {isWatching ? "Unfollow task" : "Follow task"}
    </button>
  );
};

const NEXT_SUBTASK_STATUS = { "To Do": "In Progress", "In Progress": "Completed", Completed: "To Do" };
const SubtaskIcon = ({ status }) => (
  status === "Completed" ? <LuCircleCheck className="text-done" />
    : status === "In Progress" ? <LuLoaderCircle className="text-active" /> : <LuCircle className="text-dusk" />
);

/** Simple subtasks: title, assignee, status (click the icon to advance it), due date. */
export const Subtasks = ({ task, onChange }) => {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const base = API_PATHS.TASKS.SUBTASKS(task._id);

  const call = async (request) => {
    try {
      const { data } = await request();
      onChange(data.subtasks);
      return true;
    } catch (error) {
      toast.error(errorOf(error));
      return false;
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await call(() => axiosInstance.post(base, {
      title, assignee: assignee || null, dueDate: due || null,
    }));
    if (ok) { setTitle(""); setDue(""); }
  };

  const done = task.subtasks.filter((s) => s.status === "Completed").length;

  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display text-sm text-beam">Subtasks</h3>
        <span className="text-xs text-dusk num">{done} of {task.subtasks.length} done</span>
      </div>

      <ul className="space-y-1.5">
        {task.subtasks.map((sub) => (
          <li key={sub._id} className="flex items-center gap-3 panel-sunken rounded-lg px-3.5 py-2.5">
            <button
              type="button"
              className="text-lg cursor-pointer"
              aria-label={`${sub.title}: ${sub.status}. Click to change`}
              onClick={() => call(() => axiosInstance.put(`${base}/${sub._id}`, { status: NEXT_SUBTASK_STATUS[sub.status] }))}
            >
              <SubtaskIcon status={sub.status} />
            </button>
            <span className={`text-sm grow min-w-0 truncate ${sub.status === "Completed" ? "text-dusk line-through" : "text-beam"}`}>
              {sub.title}
            </span>
            {sub.assignee && <span className="text-xs text-mist hidden sm:inline">{sub.assignee.name}</span>}
            {sub.dueDate && <span className="text-xs text-dusk num">{moment(sub.dueDate).format("D MMM")}</span>}
            <button
              type="button"
              className="text-dusk hover:text-alert cursor-pointer"
              aria-label={`Remove ${sub.title}`}
              onClick={() => call(() => axiosInstance.delete(`${base}/${sub._id}`))}
            >
              <LuX />
            </button>
          </li>
        ))}
        {task.subtasks.length === 0 && <li className="text-sm text-dusk">No subtasks yet.</li>}
      </ul>

      <form onSubmit={add} className="flex flex-wrap gap-2 mt-3">
        <input
          className="field flex-1 min-w-[180px] py-2"
          placeholder="Add a subtask"
          aria-label="Subtask title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select className="field w-auto py-2" aria-label="Subtask assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Unassigned</option>
          {task.assignedTo.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
        </select>
        <input type="date" className="field w-auto py-2" aria-label="Subtask due date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={!title.trim()}><LuPlus /> Add</button>
      </form>
    </div>
  );
};

/** What this task is waiting on: list, remove, and search-to-add. The server refuses loops. */
export const BlockedBy = ({ task, onChange }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const { data } = await axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, { params: { search: query.trim() } });
        const taken = new Set([task._id, ...task.blockedBy.map((t) => t._id)]);
        setResults((data.tasks || []).filter((t) => !taken.has(t._id)).slice(0, 5));
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, task._id, task.blockedBy]);

  const save = async (ids) => {
    try {
      const { data } = await axiosInstance.put(API_PATHS.TASKS.BLOCKED_BY(task._id), { blockedBy: ids });
      onChange({ blockedBy: data.blockedBy, waitingFor: data.waitingFor });
      setQuery("");
    } catch (error) {
      toast.error(errorOf(error));
    }
  };

  const ids = task.blockedBy.map((t) => t._id);

  return (
    <div>
      <p className="field-label mb-2">Blocked by</p>
      <ul className="space-y-1.5 mb-2">
        {task.blockedBy.map((t) => (
          <li key={t._id} className="flex items-center gap-2 text-sm">
            <LuLink className="text-dusk shrink-0" />
            <span className="grow min-w-0 truncate text-beam">{t.title}</span>
            <span className={`chip ${statusChip(t.status)}`}>{t.status}</span>
            <button type="button" className="text-dusk hover:text-alert cursor-pointer" aria-label={`Stop waiting for ${t.title}`}
              onClick={() => save(ids.filter((id) => id !== t._id))}><LuX /></button>
          </li>
        ))}
        {task.blockedBy.length === 0 && <li className="text-sm text-dusk">Nothing.</li>}
      </ul>
      <input
        className="field py-2"
        placeholder="Search a task to wait for"
        aria-label="Search a task this one is blocked by"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="panel-sunken rounded-lg mt-1">
          {results.map((t) => (
            <li key={t._id}>
              <button type="button" className="w-full text-left text-sm text-beam px-3 py-2 hover:bg-white/6 cursor-pointer"
                onClick={() => save([...ids, t._id])}>{t.title}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const ActivityTimeline = ({ activity = [] }) => (
  <div className="mt-8">
    <h3 className="font-display text-sm text-beam mb-3">Activity</h3>
    <ol className="space-y-2 border-l border-white/10 pl-4">
      {[...activity].reverse().map((entry, i) => (
        <li key={`${entry.at}_${i}`} className="text-sm">
          <span className="text-beam font-medium">{entry.user?.name || "Someone"}</span>{" "}
          <span className="text-mist">{entry.text}</span>
          <span className="text-xs text-dusk ml-2" title={moment(entry.at).format("D MMM YYYY, h:mm a")}>{moment(entry.at).fromNow()}</span>
        </li>
      ))}
      {activity.length === 0 && <li className="text-sm text-dusk">No activity recorded yet.</li>}
    </ol>
  </div>
);

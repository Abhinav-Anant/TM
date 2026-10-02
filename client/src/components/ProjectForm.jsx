import React, { useEffect, useState } from 'react';
import moment from 'moment';
import toast from 'react-hot-toast';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { PRIORITY_DATA, PROJECT_STATUS_DATA } from '../utils/data';

const dateInput = (value) => (value ? moment(value).format('YYYY-MM-DD') : '');

const blank = {
  name: '', description: '', manager: '', department: '', members: [],
  status: 'Planning', priority: 'Medium', startDate: '', dueDate: '', tagsText: '',
};

const fromProject = (p) => ({
  name: p.name,
  description: p.description || '',
  manager: p.manager?._id || '',
  department: p.department?._id || '',
  members: (p.members || []).map((m) => m._id),
  status: p.status,
  priority: p.priority,
  startDate: dateInput(p.startDate),
  dueDate: dateInput(p.dueDate),
  tagsText: (p.tags || []).map((t) => `#${t}`).join(' '),
});

/** Create / edit form. Only the name is required; everything else can be filled in later. */
const ProjectForm = ({ project, onSaved, onCancel }) => {
  const [form, setForm] = useState(project ? fromProject(project) : blank);
  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // The user list is admin/head only. A project manager who is a plain member
    // keeps editing the project; the people pickers just show who is already on it.
    axiosInstance.get(API_PATHS.USERS.GET_ALL_USERS).then(({ data }) => setPeople(data || [])).catch(() => {
      setPeople([project?.manager, ...(project?.members || [])].filter(Boolean));
    });
    axiosInstance.get(API_PATHS.DEPARTMENTS.GET_ALL).then(({ data }) => setDepartments(data?.departments || data || [])).catch(() => setDepartments([]));
  }, [project]);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const toggleMember = (id) => set('members', form.members.includes(id) ? form.members.filter((m) => m !== id) : [...form.members, id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Give the project a name.'); return; }
    setSaving(true);
    setError('');
    const body = {
      name: form.name,
      description: form.description,
      manager: form.manager || null,
      department: form.department || null,
      members: form.members,
      status: form.status,
      priority: form.priority,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      tags: form.tagsText.split(/[,\s]+/).filter(Boolean),
    };
    try {
      if (project) await axiosInstance.put(API_PATHS.PROJECTS.UPDATE(project._id), body);
      else await axiosInstance.post(API_PATHS.PROJECTS.CREATE, body);
      toast.success(project ? 'Project saved' : 'Project created');
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'That did not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div>
        <label className="field-label" htmlFor="project-name">Project name</label>
        <input id="project-name" className="field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Website Development" autoFocus />
      </div>
      <div>
        <label className="field-label" htmlFor="project-description">Description</label>
        <textarea id="project-description" className="field" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="field-label" htmlFor="project-manager">Project manager</label>
          <select id="project-manager" className="field" value={form.manager} onChange={(e) => set('manager', e.target.value)}>
            <option value="">No manager</option>
            {people.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="project-department">Department</label>
          <select id="project-department" className="field" value={form.department} onChange={(e) => set('department', e.target.value)}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="project-status">Status</label>
          <select id="project-status" className="field" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {PROJECT_STATUS_DATA.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="project-priority">Priority</label>
          <select id="project-priority" className="field" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITY_DATA.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="project-start">Start date</label>
          <input id="project-start" type="date" className="field" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="project-due">Due date</label>
          <input id="project-due" type="date" className="field" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="project-tags">Tags</label>
        <input id="project-tags" className="field" placeholder="#website #customer" value={form.tagsText} onChange={(e) => set('tagsText', e.target.value)} />
      </div>

      <fieldset>
        <legend className="field-label">Members</legend>
        <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
          {people.map((u) => (
            <label key={u._id} className={`chip cursor-pointer ${form.members.includes(u._id) ? 'chip-signal' : 'chip-mist'}`}>
              <input type="checkbox" className="sr-only" checked={form.members.includes(u._id)} onChange={() => toggleMember(u._id)} />
              {u.name}
            </label>
          ))}
          {people.length === 0 && <span className="text-sm text-dusk">No people to choose from.</span>}
        </div>
      </fieldset>

      {error && <p role="alert" className="chip chip-alert w-full justify-start">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving' : (project ? 'Save changes' : 'Create project')}</button>
      </div>
    </form>
  );
};

export default ProjectForm;

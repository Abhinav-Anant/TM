import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuPencil, LuTrash2, LuPlus, LuInbox } from 'react-icons/lu';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import Progress from '../../components/layouts/Progress';
import Modal from '../../components/layouts/Modal';
import Pager from '../../components/Pager';
import ProjectForm from '../../components/ProjectForm';
import TaskCard from '../../components/Cards/TaskCard';
import DeleteAlert from '../../customcomponent/DeleteAlert';
import { TagChips } from '../../components/TaskExtras';
import { ProjectStats } from './Projects';
import { UserContext } from '../../context/userContext';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { projectStatusChip, priorityChip } from '../../utils/data';
import { basePathFor, canAssignTasks } from '../../utils/roles';

const PAGE_SIZE = 12;

const ProjectDetail = () => {
  const { id } = useParams();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadProject = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get(API_PATHS.PROJECTS.GET_BY_ID(id));
      setProject(data);
    } catch (error) {
      if (error.response?.status === 404) setNotFound(true);
      else toast.error('Could not load this project.');
    }
  }, [id]);

  const loadTasks = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, {
        params: { project: id, page, limit: PAGE_SIZE, sortBy: 'dueDate', sortOrder: 'asc' },
      });
      setTasks(data.tasks || []);
      setPagination(data.pagination);
    } catch {
      toast.error('Could not load the tasks.');
    }
  }, [id, page]);

  useEffect(() => { loadProject(); }, [loadProject]);
  useEffect(() => { loadTasks(); }, [loadTasks]);

  const remove = async () => {
    try {
      await axiosInstance.delete(API_PATHS.PROJECTS.DELETE(id));
      toast.success('Project deleted. Its tasks were kept.');
      navigate('/projects');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete the project.');
    }
  };

  if (notFound) {
    return (
      <DashboardLayout activeMenu="Projects">
        <div className="panel p-12 mt-6 text-center">
          <p className="text-beam">That project does not exist, or you do not have access.</p>
          <Link to="/projects" className="btn mt-4">Back to projects</Link>
        </div>
      </DashboardLayout>
    );
  }

  if (!project) {
    return (
      <DashboardLayout activeMenu="Projects">
        <div className="py-6 space-y-4"><div className="skeleton h-40" /><div className="skeleton h-64" /></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activeMenu="Projects">
      <div className="py-6 space-y-4">
        <div className="panel p-6 md:p-8 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link to="/projects" className="text-xs text-dusk hover:text-beam">&larr; Projects</Link>
              <h2 className="font-display text-2xl text-beam leading-snug mt-1">{project.name}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${projectStatusChip(project.status)}`}>{project.status}</span>
              <span className={`chip ${priorityChip(project.priority)}`}>{project.priority}</span>
              {project.canManage && <button className="btn btn-sm" onClick={() => setEditing(true)}><LuPencil /> Edit</button>}
              {user?.role === 'admin' && <button className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}><LuTrash2 /> Delete</button>}
            </div>
          </div>

          {project.description && <p className="text-sm text-mist leading-relaxed whitespace-pre-wrap">{project.description}</p>}
          <TagChips tags={project.tags} />

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-display text-3xl text-beam num">{project.stats.progress}%</span>
              <span className="text-xs text-dusk">{project.stats.completed} of {project.stats.total} tasks done</span>
            </div>
            <Progress progress={project.stats.progress} status={project.status === 'Completed' ? 'Completed' : 'In Progress'} />
          </div>

          <ProjectStats stats={project.stats} />

          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm pt-4 border-t border-white/8">
            <div><dt className="text-xs text-dusk">Manager</dt><dd className="text-beam">{project.manager?.name || 'None'}</dd></div>
            <div><dt className="text-xs text-dusk">Department</dt><dd className="text-beam">{project.department?.name || 'None'}</dd></div>
            <div><dt className="text-xs text-dusk">Start</dt><dd className="text-beam num">{project.startDate ? moment(project.startDate).format('D MMM YYYY') : 'Not set'}</dd></div>
            <div><dt className="text-xs text-dusk">Due</dt><dd className="text-beam num">{project.dueDate ? moment(project.dueDate).format('D MMM YYYY') : 'Not set'}</dd></div>
            <div className="col-span-2 md:col-span-4">
              <dt className="text-xs text-dusk">Members</dt>
              <dd className="text-beam">{project.members.length ? project.members.map((m) => m.name).join(', ') : 'No members yet'}</dd>
            </div>
          </dl>
        </div>

        <div className="flex items-center justify-between pt-2">
          <h3 className="font-display text-lg text-beam">Tasks</h3>
          {canAssignTasks(user) && (
            <button className="btn btn-sm" onClick={() => navigate(`${basePathFor(user)}/create-task`, { state: { projectId: id } })}>
              <LuPlus /> Add task
            </button>
          )}
        </div>

        {tasks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
          <div className="panel p-10 text-center">
            <LuInbox className="text-3xl text-dusk mx-auto" />
            <p className="text-beam mt-3">No tasks you can see in this project yet.</p>
          </div>
        )}
        <Pager page={page} pages={pagination.pages} total={pagination.total} onChange={setPage} />
      </div>

      <Modal isOpen={editing} onClose={() => setEditing(false)} title="Edit project">
        {editing && <ProjectForm project={project} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); loadProject(); }} />}
      </Modal>
      <Modal isOpen={deleting} onClose={() => setDeleting(false)} title="Delete this project?">
        <DeleteAlert content="The project goes away. Its tasks are kept, just no longer grouped under it." onDelete={remove} />
      </Modal>
    </DashboardLayout>
  );
};

export default ProjectDetail;

import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_PATHS } from '../../utils/apiPaths';
import axiosInstance from '../../utils/axiosInstance';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import moment from 'moment'
import AvatarGroup from '../../components/layouts/AvatarGroup';
import Progress from '../../components/layouts/Progress';
import TaskComments from '../../components/TaskComments';
import { categoryColor, statusChip, priorityChip } from '../../utils/data';
import { LuSquareArrowUpRight, LuTriangleAlert, LuCheck } from 'react-icons/lu';

const ViewTaskDetails = () => {
  const { id } = useParams();
  const [task, setTask] = useState(null);

  const getTaskDetailsById = async () => {
    try {
      const response = await axiosInstance.get(API_PATHS.TASKS.GET_TASK_BY_ID(id));
      if (response.data) setTask(response.data)
    } catch (error) {
      console.error("Error fetching task", error)
    }
  };

  const updateTodoChecklist = async (index) => {
    const todoChecklist = [...(task?.todoChecklist || [])];
    if (!todoChecklist[index]) return;

    todoChecklist[index] = { ...todoChecklist[index], completed: !todoChecklist[index].completed };

    try {
      const response = await axiosInstance.put(
        API_PATHS.TASKS.UPDATE_TODO_CHECKLIST(id),
        { todoChecklist }
      );
      if (response.status === 200) {
        setTask(response.data?.task || task);
      }
    } catch (error) {
      console.error("Error updating checklist", error);
    }
  };

  useEffect(() => {
    if (id) getTaskDetailsById()
  }, [id])

  const isOverdue = task && task.status !== "Completed" && moment(task.dueDate).isBefore(moment(), 'day');
  const doneCount = (task?.todoChecklist || []).filter((t) => t.completed).length;

  if (!task) {
    return (
      <DashboardLayout activeMenu="My Tasks">
        <div className="py-6 space-y-4">
          <div className="skeleton h-40" />
          <div className="skeleton h-72" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activeMenu="My Tasks">
      <div className="py-6 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          <div className="panel p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="font-display text-2xl text-beam leading-snug">{task.title}</h2>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <span className={`chip border ${categoryColor(task.category || 'General')}`}>
                  {task.category || 'General'}
                </span>
                <span className={`chip ${statusChip(task.status)}`}>{task.status}</span>
              </div>
            </div>

            {task.description && (
              <p className="text-sm text-mist leading-relaxed mt-4 whitespace-pre-wrap">
                {task.description}
              </p>
            )}

            <div className="mt-8">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-sm text-beam">Checklist</h3>
                <span className="text-xs text-dusk num">
                  {doneCount} of {task.todoChecklist?.length || 0} done
                </span>
              </div>

              <ul className="space-y-1.5">
                {task.todoChecklist?.map((item, index) => (
                  <TodoChecklist
                    key={item._id || `todo_${index}`}
                    text={item.text}
                    isChecked={item?.completed}
                    onChange={() => updateTodoChecklist(index)}
                  />
                ))}
                {(task.todoChecklist || []).length === 0 && (
                  <li className="text-sm text-dusk">No checklist on this task.</li>
                )}
              </ul>
            </div>

            {task.attachments?.length > 0 && (
              <div className="mt-8">
                <h3 className="font-display text-sm text-beam mb-3">Attachments</h3>
                <div className="space-y-2">
                  {task.attachments.map((link, index) => (
                    <Attachment key={`link_${index}`} link={link} />
                  ))}
                </div>
              </div>
            )}

            <TaskComments
              taskId={id}
              comments={task.comments || []}
              onChange={(comments) => setTask((prev) => ({ ...prev, comments }))}
            />
          </div>
        </div>

        {/* Everything you check without reading: who, when, how far along. */}
        <aside className="panel p-6 lg:sticky lg:top-[89px] space-y-6">
          <div>
            <p className="field-label mb-2">Progress</p>
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-display text-2xl text-beam num">{task.progress || 0}%</span>
            </div>
            <Progress progress={task.progress || 0} status={task.status} />
          </div>

          <div>
            <p className="field-label mb-2">Priority</p>
            <span className={`chip ${priorityChip(task.priority)}`}>{task.priority}</span>
          </div>

          <div>
            <p className="field-label mb-2">Due date</p>
            <p className={`text-sm font-medium flex items-center gap-1.5 num ${isOverdue ? 'text-alert' : 'text-beam'}`}>
              {isOverdue && <LuTriangleAlert className="shrink-0" />}
              {task.dueDate ? moment(task.dueDate).format("D MMM YYYY") : 'Not set'}
            </p>
            {isOverdue && (
              <p className="text-xs text-alert/80 mt-1">
                Overdue by {moment(task.dueDate).fromNow(true)}.
              </p>
            )}
          </div>

          <div>
            <p className="field-label mb-2">Assigned to</p>
            <AvatarGroup
              avatars={task.assignedTo?.map((item) => item?.profileImageUrl) || []}
              maxVisible={5}
            />
          </div>
        </aside>
      </div>
    </DashboardLayout>
  )
}

export default ViewTaskDetails;

const TodoChecklist = ({ text, isChecked, onChange }) => (
  <li>
    <label className="flex items-center gap-3 panel-sunken rounded-lg px-3.5 py-2.5 cursor-pointer hover:bg-white/6 transition-colors">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={onChange}
        className="sr-only peer"
      />
      {/* A drawn box, so the tick lands in the app's own colours rather than
          the browser's. */}
      <span
        aria-hidden="true"
        className={`grid place-items-center w-[18px] h-[18px] shrink-0 rounded border transition-colors ${
          isChecked ? 'bg-done border-done text-void' : 'border-white/25 text-transparent'
        } peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-signal peer-focus-visible:outline-offset-2`}
      >
        <LuCheck className="text-[13px]" />
      </span>
      <span className={`text-sm ${isChecked ? 'text-dusk line-through' : 'text-beam'}`}>{text}</span>
    </label>
  </li>
);

const Attachment = ({ link }) => {
  const name = decodeURIComponent(link.split("/").pop() || link).replace(/^\d{10,}-/, "");

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 panel-sunken rounded-lg px-3.5 py-2.5 hover:bg-white/6 transition-colors group"
    >
      <p className="text-sm text-beam truncate group-hover:text-signal transition-colors" title={link}>
        {name}
      </p>
      <LuSquareArrowUpRight className="text-dusk shrink-0" />
    </a>
  );
};

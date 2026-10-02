import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_PATHS } from '../../utils/apiPaths';
import axiosInstance from '../../utils/axiosInstance';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import moment from 'moment'
import AvatarGroup from '../../components/layouts/AvatarGroup';
import Progress from '../../components/layouts/Progress';
import TaskComments from '../../components/TaskComments';
import { categoryColor, statusChip, priorityChip, SETTABLE_STATUS_DATA } from '../../utils/data';
import { TagChips, WaitingBanner, WatchButton, Subtasks, BlockedBy, ActivityTimeline } from '../../components/TaskExtras';
import { LuSquareArrowUpRight, LuTriangleAlert, LuCheck, LuRepeat } from 'react-icons/lu';
import toast from 'react-hot-toast';

const ViewTaskDetails = () => {
  const { id } = useParams();
  const [task, setTask] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);

  // The server re-checks permission; canReview only decides whether to show the buttons.
  const review = async (action) => {
    setReviewing(true);
    try {
      const { data } = await axiosInstance.put(API_PATHS.TASKS.REVIEW_TASK(id), { action, note: reviewNote });
      setTask({ ...data.task, canReview: task.canReview });
      setReviewNote("");
      toast.success(action === "approve" ? "Approved" : "Sent back");
    } catch (error) {
      toast.error(error.response?.data?.message || "That did not go through.");
    } finally {
      setReviewing(false);
    }
  };

  // Asking for Completed is enough: the server turns it into In Review when
  // the task needs sign-off from someone else. Refetch because the status
  // response is not populated.
  const finish = async () => {
    setReviewing(true);
    try {
      const { data } = await axiosInstance.put(API_PATHS.TASKS.UPDATE_TASK_STATUS(id), { status: "Completed" });
      await getTaskDetailsById();
      toast.success(data.updatedTask?.status === "In Review" ? "Submitted for review" : "Marked as done");
    } catch (error) {
      toast.error(error.response?.data?.message || "That did not go through.");
    } finally {
      setReviewing(false);
    }
  };

  // Hand-set statuses (not Completed / In Review - those have their own buttons).
  const setStatus = async (status) => {
    try {
      await axiosInstance.put(API_PATHS.TASKS.UPDATE_TASK_STATUS(id), { status });
      await getTaskDetailsById();
    } catch (error) {
      toast.error(error.response?.data?.message || "That did not go through.");
    }
  };

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
        setTask((prev) => ({ ...(response.data?.task || prev), canReview: prev.canReview }));
      }
    } catch (error) {
      console.error("Error updating checklist", error);
    }
  };

  useEffect(() => {
    if (id) getTaskDetailsById()
  }, [id])

  const isOverdue = task && task.dueDate && !["Completed", "Cancelled"].includes(task.status) && moment(task.dueDate).isBefore(moment(), 'day');
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
                {task.recurrence && task.recurrence !== "none" && (
                  <span className="chip chip-mist flex items-center gap-1"><LuRepeat /> Repeats {task.recurrence}</span>
                )}
              </div>
            </div>

            <WaitingBanner waitingFor={task.waitingFor} />

            {task.description && (
              <p className="text-sm text-mist leading-relaxed mt-4 whitespace-pre-wrap">
                {task.description}
              </p>
            )}

            <div className="mt-4"><TagChips tags={task.tags} /></div>

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

            <Subtasks task={task} onChange={(subtasks) => setTask((prev) => ({ ...prev, subtasks }))} />

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

            <ActivityTimeline activity={task.activity} />

            <TaskComments
              taskId={id}
              comments={task.comments || []}
              onChange={(comments) => setTask((prev) => ({ ...prev, comments }))}
            />
          </div>
        </div>

        {/* Everything you check without reading: who, when, how far along. */}
        <aside className="panel p-6 lg:sticky lg:top-[89px] space-y-6">
          {task.status === "In Review" && task.canReview && (
            <div className="space-y-3">
              <label className="field-label" htmlFor="review-note">Waiting for your review</label>
              <textarea
                id="review-note"
                className="field"
                rows={3}
                placeholder="Note for the assignee (sent with Send back)"
                value={reviewNote}
                onChange={({ target }) => setReviewNote(target.value)}
              />
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={reviewing} onClick={() => review("approve")}>Approve</button>
                <button className="btn" disabled={reviewing} onClick={() => review("reject")}>Send back</button>
              </div>
            </div>
          )}
          {task.status === "In Review" && !task.canReview && (
            <p className="text-sm text-signal">Submitted. Waiting for approval.</p>
          )}
          <WatchButton
            taskId={id}
            isWatching={task.isWatching}
            onChange={(isWatching) => setTask((prev) => ({ ...prev, isWatching }))}
          />
          {!["In Review", "Completed", "Cancelled"].includes(task.status) && (
            <button className="btn btn-primary w-full" disabled={reviewing} onClick={finish}>
              {task.requiresReview && !task.canReview ? "Submit for review" : "Mark as done"}
            </button>
          )}

          {["To Do", "In Progress", "Blocked", "Cancelled"].includes(task.status) && (
            <div>
              <label className="field-label mb-2 block" htmlFor="task-status">Status</label>
              <select id="task-status" className="field py-2" value={task.status} onChange={(e) => setStatus(e.target.value)}>
                {SETTABLE_STATUS_DATA.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}

          <BlockedBy
            task={task}
            onChange={({ blockedBy, waitingFor }) => setTask((prev) => ({ ...prev, blockedBy, waitingFor }))}
          />

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
          isChecked ? 'bg-done border-done text-ink' : 'border-white/25 text-transparent'
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

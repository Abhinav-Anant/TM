import React, { useState, useEffect, useContext } from 'react';
import DashboardLayout from "../../components/layouts/DashboardLayout";
import { API_PATHS } from '../../utils/apiPaths';
import { PRIORITY_DATA, CATEGORY_DATA, RECURRENCE_DATA } from '../../utils/data';
import axiosInstance from '../../utils/axiosInstance';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LuTrash2 } from 'react-icons/lu';
import moment from 'moment';
import toast from 'react-hot-toast';
import SelectDropdown from '../../customcomponent/SelectDropdown';
import SelectUsers from '../../customcomponent/SelectUsers';
import TodoListInput from '../../customcomponent/TodoListInput';
import AddAttachmentsInput from '../../customcomponent/AddAttachmentsInput';
import Modal from '../../components/layouts/Modal';
import DeleteAlert from '../../customcomponent/DeleteAlert';
import { UserContext } from '../../context/userContext';
import { basePathFor } from '../../utils/roles';

const CreateTask = () => {
  const { user } = useContext(UserContext);
  const location = useLocation();
  const { taskId } = location.state || {};
  const navigate = useNavigate();

  const [taskData, setTaskData] = useState({
    title: "",
    description: "",
    priority: "Low",
    category: "General",
    dueDate: null,
    assignedTo: [],
    todoChecklist: [],
    attachments: [],
    requiresReview: true,
    recurrence: "none",
  });

  const [currentTask, setCurrentTask] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [openDeleteAlert, setOpenDeleteAlert] = useState(false);

  const handleValueChange = (key, value) => {
    setTaskData((prevData) => ({ ...prevData, [key]: value }));
  };

  const clearData = () => {
    setTaskData({
      title: "",
      description: "",
      priority: "Low",
      category: "General",
      dueDate: null,
      assignedTo: [],
      todoChecklist: [],
      attachments: [],
      requiresReview: true,
      recurrence: "none",
    });
  };

  const createTask = async () => {
    setLoading(true);
    try {
      const todolist = taskData.todoChecklist?.map((item) => ({
        text: item,
        completed: false,
      }));

      await axiosInstance.post(API_PATHS.TASKS.CREATE_TASK, {
        ...taskData,
        dueDate: new Date(taskData.dueDate).toISOString(),
        todoChecklist: todolist,
      });

      toast.success("Task created");
      clearData();
      navigate(`${basePathFor(user)}/tasks`);
    } catch (error) {
      setError("That did not save. Check your connection and try again.");
      console.error("Error creating task:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateTask = async () => {
    setLoading(true);
    try {
      const todolist = taskData.todoChecklist?.map((item) => {
        const prevTodoChecklist = currentTask?.todoChecklist || [];
        const matchedTask = prevTodoChecklist.find((task) => task.text === item);
        return {
          text: item,
          completed: matchedTask ? matchedTask.completed : false,
        };
      });

      await axiosInstance.put(API_PATHS.TASKS.UPDATE_TASK(taskId), {
        ...taskData,
        dueDate: new Date(taskData.dueDate).toISOString(),
        todoChecklist: todolist,
      });

      toast.success("Changes saved");
    } catch (error) {
      setError("That did not save. Check your connection and try again.");
      console.error("Error updating task:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);

    if (!taskData.title.trim()) {
      setError("Give the task a title.");
      return;
    }
    if (!taskData.description.trim()) {
      setError("Add a description so it is clear what to do.");
      return;
    }
    if (!taskData.dueDate?.trim()) {
      setError("Pick a due date.");
      return;
    }
    if (taskData.assignedTo?.length === 0) {
      setError("Assign this task to at least one person.");
      return;
    }
    if (taskData.todoChecklist?.length === 0) {
      setError("Add at least one checklist item.");
      return;
    }

    taskId ? updateTask() : createTask();
  };

  const getTaskDetailsById = async () => {
    setLoading(true);
    try {
      const response = await axiosInstance.get(API_PATHS.TASKS.GET_TASK_BY_ID(taskId));
      if (response.data) {
        setCurrentTask(response.data);
        setTaskData({
          title: response.data.title,
          description: response.data.description,
          priority: response.data.priority,
          category: response.data.category || 'General',
          dueDate: response.data.dueDate ? moment(response.data.dueDate).format('YYYY-MM-DD') : null,
          assignedTo: response.data?.assignedTo?.map((item) => item?._id) || [],
          todoChecklist: response.data?.todoChecklist?.map((item) => item.text) || [],
          attachments: response.data?.attachments || [],
          requiresReview: Boolean(response.data.requiresReview),
          recurrence: response.data.recurrence || "none",
        });
      }
    } catch (error) {
      setError("Could not load this task.");
      console.error("Error fetching task:", error);
    } finally {
      setLoading(false);
    }
  };

  const deleteTask = async () => {
    setLoading(true);
    try {
      await axiosInstance.delete(API_PATHS.TASKS.DELETE_TASK(taskId));
      setOpenDeleteAlert(false);
      toast.success("Task deleted");
      navigate(`${basePathFor(user)}/tasks`);
    } catch (error) {
      toast.error("Could not delete the task. Try again.");
      console.error("Error deleting task:", error.response?.data?.message || error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (taskId) {
      getTaskDetailsById(taskId);
    }
  }, [taskId]);

  return (
    <DashboardLayout activeMenu="Create Task">
      <div className="py-6 max-w-5xl mx-auto">
        <div className="panel p-6 md:p-8">
          {currentTask?.status === "In Review" && (
            <Link to={`/user/task-details/${taskId}`} className="block text-sm text-signal mb-4">
              This task is waiting for review. Open it to approve or send it back.
            </Link>
          )}

          <div className="flex items-center justify-between gap-4 pb-5 mb-7 border-b border-white/8">
            <h2 className="font-display text-2xl text-beam">
              {taskId ? "Update task" : "Create a task"}
            </h2>
            {taskId && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setOpenDeleteAlert(true)}
                disabled={loading}
              >
                <LuTrash2 />
                {loading ? "Deleting" : "Delete"}
              </button>
            )}
          </div>

          <div className="space-y-6">
            <div>
              <label className="field-label" htmlFor="task-title">Title</label>
              <input
                id="task-title"
                className="field"
                placeholder="What needs to happen?"
                value={taskData.title}
                onChange={({ target }) => handleValueChange("title", target.value)}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="task-description">Description</label>
              <textarea
                id="task-description"
                className="field resize-y"
                rows={4}
                placeholder="Add the context whoever picks this up will need."
                value={taskData.description}
                onChange={({ target }) => handleValueChange("description", target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
              <div>
                <label className="field-label" htmlFor="task-category">Category</label>
                <input
                  id="task-category"
                  list="task-categories"
                  className="field"
                  placeholder="e.g. Design"
                  value={taskData.category}
                  onChange={({ target }) => handleValueChange("category", target.value)}
                />
                <datalist id="task-categories">
                  {CATEGORY_DATA.map((c) => (
                    <option key={c.value} value={c.value} />
                  ))}
                </datalist>
              </div>

              <div>
                <span className="field-label">Priority</span>
                <SelectDropdown
                  options={PRIORITY_DATA}
                  value={taskData.priority}
                  onChange={(value) => handleValueChange("priority", value)}
                  placeholder="Select a priority"
                />
              </div>

              <div>
                <label className="field-label" htmlFor="task-due">Due date</label>
                <input
                  id="task-due"
                  type="date"
                  className="field"
                  value={taskData.dueDate || ''}
                  onChange={({ target }) => handleValueChange("dueDate", target.value)}
                />
              </div>

              <div>
                <span id="task-recurrence-label" className="field-label">Repeat</span>
                <SelectDropdown
                  options={RECURRENCE_DATA}
                  value={taskData.recurrence}
                  onChange={(value) => handleValueChange("recurrence", value)}
                  placeholder="Does not repeat"
                  labelledBy="task-recurrence-label"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-beam cursor-pointer self-end pb-2">
                <input
                  type="checkbox"
                  checked={taskData.requiresReview}
                  onChange={({ target }) => handleValueChange("requiresReview", target.checked)}
                />
                Needs approval before it counts as done
              </label>

              <div>
                <span className="field-label">Assigned to</span>
                <SelectUsers
                  selectedUsers={taskData.assignedTo}
                  setSelectedUsers={(value) => handleValueChange("assignedTo", value)}
                />
              </div>
            </div>

            <div>
              <span className="field-label">Checklist</span>
              <TodoListInput
                todoList={taskData.todoChecklist}
                setTodoList={(value) => handleValueChange("todoChecklist", value)}
              />
            </div>

            <div>
              <span className="field-label">Attachments</span>
              <AddAttachmentsInput
                attachments={taskData.attachments}
                setAttachments={(value) => handleValueChange("attachments", value)}
              />
            </div>

            {error && (
              <p role="alert" className="chip chip-alert w-full justify-start">
                {error}
              </p>
            )}

            <div className="flex justify-end pt-2">
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading
                  ? (taskId ? "Saving" : "Creating")
                  : (taskId ? "Save changes" : "Create task")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={openDeleteAlert}
        onClose={() => setOpenDeleteAlert(false)}
        title="Delete this task?"
      >
        <DeleteAlert
          content="This removes the task, its checklist and its comments for everyone. It cannot be undone."
          onDelete={deleteTask}
        />
      </Modal>
    </DashboardLayout>
  );
};

export default CreateTask;

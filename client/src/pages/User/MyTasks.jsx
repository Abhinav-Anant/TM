import React from 'react';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import { useNavigate } from 'react-router-dom';
import TaskStatusTab from '../../components/layouts/TaskStatusTab';
import TaskCard from '../../components/Cards/TaskCard';
import TaskFilters from '../../components/TaskFilters';
import useTaskList from '../../hooks/useTaskList';
import HashLoader from 'react-spinners/HashLoader';

const MyTasks = () => {
  const { tasks, tabs, categories, status, setStatus, filters, setFilters, loading } = useTaskList();
  const navigate = useNavigate();

  const handleClick = (taskId) => {
    if (taskId) navigate(`/user/task-details/${taskId}`);
  };

  return (
    <DashboardLayout activeMenu="My Tasks">
      <div className="my-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between">
          <h2 className="text-xl font-medium">My Tasks</h2>
          <TaskStatusTab tabs={tabs} activeTab={status} setActiveTab={setStatus} />
        </div>

        <TaskFilters filters={filters} setFilters={setFilters} categories={categories} />

        {loading ? (
          <div className="flex justify-center items-center h-[300px]">
            <HashLoader color="#6366F1" size={70} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <TaskCard
                  key={task._id}
                  title={task.title}
                  description={task.description}
                  priority={task.priority}
                  status={task.status}
                  category={task.category}
                  progress={task.progress}
                  createdAt={task.createdAt}
                  dueDate={task.dueDate}
                  assignedTo={(task.assignedTo || []).map((a) => a.profileImageUrl)}
                  attachmentCount={task.attachments?.length || 0}
                  commentCount={task.comments?.length || 0}
                  completedTodoCount={task.completedTodoCount || 0}
                  todoChecklist={task.todoChecklist || []}
                  onClick={() => handleClick(task._id)}
                />
              ))
            ) : (
              <p className="text-gray-500 col-span-full text-center mt-10">
                No tasks match these filters.
              </p>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default MyTasks;

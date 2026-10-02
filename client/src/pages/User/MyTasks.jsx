import React from 'react';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import { useNavigate } from 'react-router-dom';
import TaskStatusTab from '../../components/layouts/TaskStatusTab';
import TaskCard from '../../components/Cards/TaskCard';
import TaskFilters from '../../components/TaskFilters';
import useTaskList from '../../hooks/useTaskList';
import { LuInbox } from 'react-icons/lu';

const MyTasks = () => {
  const { tasks, tabs, categories, tags, status, setStatus, filters, setFilters, loading } = useTaskList();
  const navigate = useNavigate();

  const handleClick = (taskId) => {
    if (taskId) navigate(`/user/task-details/${taskId}`, { viewTransition: true });
  };

  return (
    <DashboardLayout activeMenu="My Tasks">
      <div className="py-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <h2 className="font-display text-2xl text-beam">My tasks</h2>
          <TaskStatusTab tabs={tabs} activeTab={status} setActiveTab={setStatus} />
        </div>

        <TaskFilters filters={filters} setFilters={setFilters} categories={categories} tags={tags} />

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-64" />)}
          </div>
        ) : tasks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            {tasks.map((task) => (
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
                tags={task.tags}
                waitingFor={task.waitingFor}
                todoChecklist={task.todoChecklist || []}
                onClick={() => handleClick(task._id)}
              />
            ))}
          </div>
        ) : (
          <div className="panel p-12 mt-4 text-center">
            <LuInbox className="text-3xl text-dusk mx-auto" />
            <p className="text-beam mt-4">Nothing here right now.</p>
            <p className="text-sm text-mist mt-1">
              Clear the filters above, or check another status tab.
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default MyTasks;

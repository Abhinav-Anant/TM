import React, { useContext } from 'react';
import DashboardLayout from "../../components/layouts/DashboardLayout";
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { LuFileSpreadsheet, LuInbox, LuPlus } from 'react-icons/lu';
import TaskStatusTab from '../../components/layouts/TaskStatusTab';
import TaskCard from '../../components/Cards/TaskCard';
import TaskFilters from '../../components/TaskFilters';
import useTaskList from '../../hooks/useTaskList';
import toast from 'react-hot-toast';
import { UserContext } from '../../context/userContext';
import { basePathFor } from '../../utils/roles';

const ManageTasks = () => {
  const { tasks, tabs, categories, tags, status, setStatus, filters, setFilters, loading } = useTaskList();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const base = basePathFor(user);

  const handleClick = (taskData) => {
    navigate(`${base}/create-task`, { state: { taskId: taskData._id }, viewTransition: true });
  };

  const handleDownloadReport = async () => {
    try {
      const response = await axiosInstance.get(API_PATHS.REPORTS.EXPORT_TASKS, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");

      link.href = url;
      link.setAttribute('download', 'tasks_report.xlsx');
      document.body.appendChild(link);
      link.click();

      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading task details:", error);
      toast.error("Could not build the report. Try again in a moment.");
    }
  };

  return (
    <DashboardLayout activeMenu="Manage Tasks">
      <div className="py-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <h2 className="font-display text-2xl text-beam">Manage tasks</h2>

          <div className="flex flex-wrap items-center gap-3">
            <TaskStatusTab tabs={tabs} activeTab={status} setActiveTab={setStatus} />
            <button className="btn btn-sm" onClick={handleDownloadReport}>
              <LuFileSpreadsheet /> Download report
            </button>
          </div>
        </div>

        <TaskFilters filters={filters} setFilters={setFilters} categories={categories} tags={tags} />

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-64" />)}
          </div>
        ) : tasks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            {tasks.map((item) => (
              <TaskCard
                key={item._id}
                title={item.title}
                description={item.description}
                priority={item.priority}
                status={item.status}
                category={item.category}
                progress={item.progress}
                createdAt={item.createdAt}
                dueDate={item.dueDate}
                assignedTo={item.assignedTo?.map((i) => i.profileImageUrl)}
                attachmentCount={item.attachments?.length || 0}
                commentCount={item.comments?.length || 0}
                completedTodoCount={item.completedTodoCount || 0}
                todoChecklist={item.todoChecklist || []}
                onClick={() => handleClick(item)}
              />
            ))}
          </div>
        ) : (
          <div className="panel p-12 mt-4 text-center">
            <LuInbox className="text-3xl text-dusk mx-auto" />
            <p className="text-beam mt-4">No tasks match these filters.</p>
            <p className="text-sm text-mist mt-1 mb-6">
              Clear the filters above, or start something new.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`${base}/create-task`, { viewTransition: true })}
            >
              <LuPlus /> Create a task
            </button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ManageTasks;

import React from 'react';
import DashboardLayout from "../../components/layouts/DashboardLayout";
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { LuFileSpreadsheet } from 'react-icons/lu';
import TaskStatusTab from '../../components/layouts/TaskStatusTab';
import TaskCard from '../../components/Cards/TaskCard';
import TaskFilters from '../../components/TaskFilters';
import useTaskList from '../../hooks/useTaskList';
import toast from 'react-hot-toast';
import HashLoader from 'react-spinners/HashLoader';

const ManageTasks = () => {
  const { tasks, tabs, categories, status, setStatus, filters, setFilters, loading } = useTaskList();
  const navigate = useNavigate();

  const handleClick = (taskData) => {
    navigate(`/admin/create-task`, { state: { taskId: taskData._id } });
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
      toast.error("Failed to download task details. Please try again.");
    }
  };

  return (
    <DashboardLayout activeMenu="Manage Tasks">
      <div className='my-5'>
        <div className='flex flex-col lg:flex-row lg:items-center justify-between'>
          <div className='flex items-center justify-between gap-3'>
            <h2 className='text-xl md:text-xl font-medium'>Manage Tasks</h2>
            <button className='flex lg:hidden download-btn' onClick={handleDownloadReport}>
              <LuFileSpreadsheet className='text-lg' />
              Download Report
            </button>
          </div>

          <div className='flex items-center gap-3'>
            <TaskStatusTab tabs={tabs} activeTab={status} setActiveTab={setStatus} />

            <button className='hidden lg:flex download-btn' onClick={handleDownloadReport}>
              <LuFileSpreadsheet className='text-lg' />
              Download Report
            </button>
          </div>
        </div>

        <TaskFilters filters={filters} setFilters={setFilters} categories={categories} />

        {loading ? (
          <div className="flex justify-center items-center h-[300px]">
            <HashLoader color="#6366F1" size={70} />
          </div>
        ) : (
          <div className='grid grid-cols-1 md:grid-cols-3 gap-4 mt-4'>
            {tasks.length > 0 ? (
              tasks.map((item) => (
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
              ))
            ) : (
              <div className="col-span-3 text-center text-gray-500 mt-10">
                No tasks match these filters.
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ManageTasks;

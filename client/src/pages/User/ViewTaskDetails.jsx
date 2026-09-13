import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_PATHS } from '../../utils/apiPaths';
import axiosInstance from '../../utils/axiosInstance';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import moment from 'moment'
import AvatarGroup from '../../components/layouts/AvatarGroup';
import Progress from '../../components/layouts/Progress';
import TaskComments from '../../components/TaskComments';
import { categoryColor } from '../../utils/data';
import { LuSquareArrowUpRight, LuTriangleAlert } from 'react-icons/lu';


const ViewTaskDetails = () => {
  const { id } = useParams();

  const [task, setTask] = useState(null);

  const getStatusTagColor = (status) => {
    switch (status) {
      case "In Progress":
        return "text-cyan-500 bg-cyan-50 border border-cyan-500/10"

      case "Completed":
        return "text-lime-500 bg-lime-50 border border-lime-500/20"

      default:
        return "text-violet-500 bg-violet-50 border border-violet-500/10"
    }
  }


  const getTaskDetailsById = async () => {
    try {
      const response = await axiosInstance.get(
        API_PATHS.TASKS.GET_TASK_BY_ID(id)
      );

      if (response.data) {
        setTask(response.data)
      }
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

  const handleClick = (link) => {
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    if (id) {
      getTaskDetailsById()
    }
  }, [id])

  const isOverdue = task && task.status !== "Completed" && moment(task.dueDate).isBefore(moment(), 'day');

  return (
    <DashboardLayout activeMenu='My Tasks'>
      <div className='mt-5'>
        {task && (<div className='grid grid-cols-1 md:grid-cols-4 mt-4'>
          <div className='form-card col-span-3'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h2 className='text-base md:text-xl font-medium'>
                {task?.title}
              </h2>
              <div className='flex items-center gap-2'>
                <div className={`text-[11px] md:text-[13px] font-medium border px-3 py-0.5 rounded ${categoryColor(task?.category || 'General')}`}>
                  {task?.category || 'General'}
                </div>
                <div className={`text-[11px] md:text-[13px] font-medium ${getStatusTagColor(task?.status)} px-4 py-0.5 rounded `}>
                  {task?.status}
                </div>
              </div>
            </div>

            <div className='mt-4'>
              <InfoBox label="Description" value={task?.description} />
            </div>

            <div className='grid grid-cols-12 gap-4 mt-4'>
              <div className='col-span-6 md:col-span-4'>
                <InfoBox label="Priority" value={task?.priority} />
              </div>
              <div className='col-span-6 md:col-span-4'>
                <label className='text-xs font-medium text-slate-500'>Due Date</label>
                <p className={`text-[12px] md:text-[13px] font-medium mt-0.5 flex items-center gap-1 ${isOverdue ? 'text-rose-600' : 'text-gray-700'}`}>
                  {isOverdue && <LuTriangleAlert className='text-xs' />}
                  {task?.dueDate ? moment(task.dueDate).format("Do MMM YYYY") : 'N/A'}
                </p>
              </div>
              <div className='col-span-6 md:col-span-4'>
                <label className='text-xs font-medium text-slate-500'>Assigned To </label>
                <AvatarGroup
                  avatars={task?.assignedTo?.map((item) => item?.profileImageUrl) || []}
                  maxVisible={5}
                />
              </div>
            </div>

            <div className='mt-4'>
              <div className='flex items-center justify-between mb-1'>
                <label className='text-xs font-medium text-slate-500'>Progress</label>
                <span className='text-xs font-medium text-gray-600'>{task?.progress || 0}%</span>
              </div>
              <Progress progress={task?.progress || 0} status={task?.status} />
            </div>

            <div className='mt-4'>
              <label className='text-xs font-medium text-slate-500'>
                Todo Checklist
              </label>
              {task?.todoChecklist?.map((item, index) => (
                <TodoChecklist
                  key={item._id || `todo_${index}`}
                  text={item.text}
                  isChecked={item?.completed}
                  onChange={() => updateTodoChecklist(index)}
                />
              ))}
            </div>

            {task?.attachments?.length > 0 && (
              <div className='mt-4'>
                <label className='text-xs font-medium text-slate-500'>
                  Attachments
                </label>
                {task.attachments.map((link, index) => (
                  <Attachment
                    key={`link_${index}`}
                    link={link}
                    index={index}
                    onClick={() => handleClick(link)}
                  />
                ))}
              </div>
            )}

            <TaskComments
              taskId={id}
              comments={task?.comments || []}
              onChange={(comments) => setTask((prev) => ({ ...prev, comments }))}
            />
          </div>
        </div>
        )}
      </div>
    </DashboardLayout>
  )
}

export default ViewTaskDetails;


const InfoBox = ({ label, value }) => (
  <>
    <label className='text-xs font-medium text-slate-500'>{label} </label>
    <p className='text-[12px] md:text-[13px] font-medium text-gray-700 mt-0.5  '>{value}</p>
  </>
);


const TodoChecklist = ({ text, isChecked, onChange }) => (
  <div className="flex items-center gap-3 p-3">
    <input
      type="checkbox"
      checked={isChecked}
      onChange={onChange}
      className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm outline-none cursor-pointer '
    />
    <p className={`text-[13px] ${isChecked ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{text}</p>
  </div>
);


const Attachment = ({ link, index, onClick }) => {
  const name = decodeURIComponent(link.split("/").pop() || link).replace(/^\d{10,}-/, "");

  return (
    <div
      className='flex justify-between bg-gray-50 border border-gray-100 px-3 py-2 rounded-md mb-3 mt-2 cursor-pointer hover:border-blue-200'
      onClick={onClick}
    >
      <div className='flex-1 flex items-center gap-3 min-w-0'>
        <span className='text-xs text-gray-400 font-semibold mr-2'>
          {index < 9 ? `0${index + 1}` : index + 1}
        </span>
        <p className='text-xs text-black truncate' title={link}>
          {name}
        </p>
      </div>
      <LuSquareArrowUpRight className='text-gray-400 shrink-0' />
    </div>
  );
};

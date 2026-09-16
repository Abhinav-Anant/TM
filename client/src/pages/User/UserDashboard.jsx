import React, { useContext, useEffect, useState } from 'react';
import useUserAuth from '../../hooks/useUserAuth';
import { UserContext } from '../../context/userContext';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import moment from 'moment';
import InfoCard from '../../components/Cards/InfoCard';
import { addThousandsSeparator } from '../../utils/helper';
import { LuArrowRight, LuListChecks, LuCircleCheck, LuLoaderCircle, LuClock } from 'react-icons/lu';
import TaskListTable from '../../components/TaskListTable';
import CustomPieChart from '../../components/Charts/CustomPieChart';
import CustomBarChart from '../../components/Charts/CustomBarChart';

const greet = () => {
  const hour = moment().hour();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const UserDashboard = () => {
  useUserAuth();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();

  const [dashboardData, setDashboardData] = useState(null);
  const [pieChartData, setPieChartData] = useState([]);
  const [barChartData, setBarChartData] = useState([]);

  const prepareChartData = (charts = {}) => {
    const taskDistribution = charts.taskDistribution || {};
    const taskPriorityLevels = charts.taskPriorityLevels || {};

    setPieChartData([
      { status: 'Pending', count: taskDistribution.Pending || 0 },
      { status: 'In Progress', count: taskDistribution.InProgress || 0 },
      { status: 'Completed', count: taskDistribution.Completed || 0 },
    ]);

    setBarChartData([
      { priority: 'Low', count: taskPriorityLevels.Low || 0 },
      { priority: 'Medium', count: taskPriorityLevels.Medium || 0 },
      { priority: 'High', count: taskPriorityLevels.High || 0 },
    ]);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const response = await axiosInstance.get(API_PATHS.TASKS.GET_USER_DASHBOARD_DATA);
        const data = response.data.data;
        if (data) {
          setDashboardData(data);
          prepareChartData(data.charts ?? {});
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      }
    };
    load();
  }, []);

  const taskDistribution = dashboardData?.charts?.taskDistribution || {};

  return (
    <DashboardLayout activeMenu="Dashboard">
      <div className="py-6 space-y-5">
        <header className="panel p-6">
          <h2 className="font-display text-2xl md:text-3xl text-beam">
            {greet()}, {user?.name || 'there'}
          </h2>
          <p className="text-sm text-mist mt-1.5 num">{moment().format('dddd, D MMMM YYYY')}</p>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <InfoCard
            icon={<LuListChecks />}
            label="All tasks"
            value={addThousandsSeparator(taskDistribution.All || 0)}
            color="bg-ice"
            tone="text-ice"
          />
          <InfoCard
            icon={<LuClock />}
            label="Pending"
            value={addThousandsSeparator(taskDistribution.Pending || 0)}
            color="bg-pending"
            tone="text-pending"
          />
          <InfoCard
            icon={<LuLoaderCircle />}
            label="In progress"
            value={addThousandsSeparator(taskDistribution.InProgress || 0)}
            color="bg-active"
            tone="text-active"
          />
          <InfoCard
            icon={<LuCircleCheck />}
            label="Completed"
            value={addThousandsSeparator(taskDistribution.Completed || 0)}
            color="bg-done"
            tone="text-done"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="panel p-6">
            <h3 className="font-display text-base text-beam">Where your work stands</h3>
            <CustomPieChart data={pieChartData} />
          </section>

          <section className="panel p-6">
            <h3 className="font-display text-base text-beam">Tasks by priority</h3>
            <div className="mt-6">
              <CustomBarChart data={barChartData} />
            </div>
          </section>
        </div>

        <section className="panel p-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-display text-base text-beam">Recent tasks</h3>
            <button className="btn btn-sm" onClick={() => navigate('/user/tasks', { viewTransition: true })}>
              See all <LuArrowRight />
            </button>
          </div>

          <div className="mt-4">
            <TaskListTable tableData={dashboardData?.recentTasks || []} />
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
};

export default UserDashboard;

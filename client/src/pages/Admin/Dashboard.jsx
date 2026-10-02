import React, { useContext, useEffect, useState } from 'react';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import { UserContext } from '../../context/userContext';
import useUserAuth from '../../hooks/useUserAuth';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import moment from 'moment';
import { LuListChecks, LuCircleCheck, LuLoaderCircle, LuClock, LuArrowRight } from 'react-icons/lu';
import InfoCard from '../../components/Cards/InfoCard';
import CustomPieChart from '../../components/Charts/CustomPieChart';
import { basePathFor } from '../../utils/roles';

/** "Good morning" at 11pm is a bug people notice. */
const greet = () => {
  const hour = moment().hour();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const Dashboard = () => {
  useUserAuth();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await axiosInstance.get(API_PATHS.TASKS.GET_DASHBOARD_DATA);
        if (response.data) setDashboardData(response.data.data);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const d = dashboardData || {};
  const pieData = [
    { status: 'To Do', count: d.pendingTasksCount || 0 },
    { status: 'In Progress', count: d.inProgressTasksCount || 0 },
    { status: 'In Review', count: d.inReviewTasksCount || 0 },
    { status: 'Completed', count: d.completedTasksCount || 0 },
  ];

  const withTasks = d.usersWithTasksCount || 0;
  const allUsers = d.allUsersCount || 0;
  const coverage = allUsers ? Math.round((withTasks / allUsers) * 100) : 0;

  return (
    <DashboardLayout activeMenu="Dashboard">
      <div className="py-6 space-y-5">
        <header className="panel p-6">
          <h2 className="font-display text-2xl md:text-3xl text-beam">
            {greet()}, {user?.name || 'there'}
          </h2>
          <p className="text-sm text-mist mt-1.5 num">{moment().format('dddd, D MMMM YYYY')}</p>
        </header>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <InfoCard icon={<LuListChecks />} label="All tasks" value={d.allTasksCount || 0} color="bg-ice" tone="text-ice" />
              <InfoCard icon={<LuClock />} label="To do" value={d.pendingTasksCount || 0} color="bg-pending" tone="text-pending" />
              <InfoCard icon={<LuLoaderCircle />} label="In progress" value={d.inProgressTasksCount || 0} color="bg-active" tone="text-active" />
              <InfoCard icon={<LuCircleCheck />} label="Completed" value={d.completedTasksCount || 0} color="bg-done" tone="text-done" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <section className="panel p-6 lg:col-span-2">
                <h3 className="font-display text-base text-beam">Where the work stands</h3>
                <CustomPieChart data={pieData} />
              </section>

              <section className="panel p-6 flex flex-col">
                <h3 className="font-display text-base text-beam">Team coverage</h3>
                <p className="text-sm text-mist mt-1">How much of the team currently has work assigned.</p>

                {/* Two counts where one contains the other is a part-to-whole,
                    so it reads as a meter rather than two bars side by side. */}
                <div className="mt-auto pt-8">
                  <p className="font-display text-4xl text-beam num leading-none">
                    {withTasks}
                    <span className="text-xl text-dusk"> / {allUsers}</span>
                  </p>
                  <p className="text-xs text-dusk mt-2">people have at least one task</p>

                  <div className="w-full h-1.5 rounded-full bg-white/8 overflow-hidden mt-4">
                    <div
                      className="h-full rounded-full bg-signal text-signal transition-[width] duration-700 ease-out"
                      style={{ width: `${coverage}%`, boxShadow: '0 0 12px 0 currentColor' }}
                    />
                  </div>
                  <p className="text-xs text-mist mt-2 num">{coverage}% covered</p>
                </div>

                <button
                  className="btn mt-6"
                  onClick={() => navigate(`${basePathFor(user)}/users`, { viewTransition: true })}
                >
                  View the team <LuArrowRight />
                </button>
              </section>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;

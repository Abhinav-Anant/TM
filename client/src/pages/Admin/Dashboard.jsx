import React, { useContext, useEffect, useState } from 'react';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import { UserContext } from '../../context/userContext';
import useUserAuth from '../../hooks/useUserAuth';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import moment from 'moment';
import { LuArrowRight } from 'react-icons/lu';
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
  const [manager, setManager] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        if (user?.role === 'admin') {
          axiosInstance.get(API_PATHS.TASKS.COMPANY_DASHBOARD, { params: { tzOffset: new Date().getTimezoneOffset() } })
            .then(({ data }) => setCompany(data)).catch(() => {});
        }
        axiosInstance.get(API_PATHS.TASKS.MANAGER_DASHBOARD, { params: { tzOffset: new Date().getTimezoneOffset() } })
          .then(({ data }) => setManager(data)).catch(() => {});
        const response = await axiosInstance.get(API_PATHS.TASKS.GET_DASHBOARD_DATA);
        if (response.data) setDashboardData(response.data.data);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.role]);

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
            {user?.role === 'admin' && (
              <section aria-label="Company" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  ['Employees', company?.employees],
                  ['Departments', company?.departments],
                  ['Projects', company?.projects],
                  ['Active projects', company?.activeProjects],
                ].map(([label, value]) => (
                  <div key={label} className="panel p-5">
                    <p className="text-[11px] uppercase tracking-wide text-dusk">{label}</p>
                    <p className="font-display text-3xl num mt-1 text-beam">{value ?? '–'}</p>
                  </div>
                ))}
              </section>
            )}

            <section aria-label="Team headline numbers" className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              {[
                ['Open tasks', manager?.totals.open, 'text-beam'],
                ['Overdue', manager?.totals.overdue, manager?.totals.overdue ? 'text-alert' : 'text-beam'],
                ['Due today', manager?.totals.dueToday, manager?.totals.dueToday ? 'text-signal' : 'text-beam'],
                ['Blocked', manager?.totals.blocked, manager?.totals.blocked ? 'text-alert' : 'text-beam'],
                ['In review', manager?.totals.inReview, 'text-signal'],
                ['Done this week', manager?.totals.completedThisWeek, 'text-done'],
              ].map(([label, value, tone]) => (
                <div key={label} className="panel p-5">
                  <p className="text-[11px] uppercase tracking-wide text-dusk">{label}</p>
                  <p className={`font-display text-3xl num mt-1 ${tone}`}>{value ?? '–'}</p>
                </div>
              ))}
            </section>

            <section className="panel p-6">
              <h3 className="font-display text-base text-beam">Who has what</h3>
              <div className="overflow-x-auto mt-3">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-dusk">
                      <th className="py-2 pr-4 font-medium">Employee</th>
                      <th className="py-2 px-4 font-medium text-right">Open</th>
                      <th className="py-2 pl-4 font-medium text-right">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(manager?.employees || []).map((e) => (
                      <tr key={e._id} className="border-t border-white/8">
                        <td className="py-2.5 pr-4">
                          <button
                            type="button" className="text-beam hover:text-signal cursor-pointer text-left"
                            onClick={() => navigate(`${basePathFor(user)}/tasks?assignee=${e._id}&name=${encodeURIComponent(e.name)}`, { viewTransition: true })}
                          >
                            {e.name}
                          </button>
                        </td>
                        <td className="py-2.5 px-4 text-right num text-beam">{e.open}</td>
                        <td className={`py-2.5 pl-4 text-right num ${e.overdue ? 'text-alert font-medium' : 'text-dusk'}`}>{e.overdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {manager && manager.employees.length === 0 && <p className="text-sm text-dusk py-4">No people to show yet.</p>}
              </div>
            </section>

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

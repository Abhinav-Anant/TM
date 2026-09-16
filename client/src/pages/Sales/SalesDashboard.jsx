import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { stageChip, formatRupees } from '../../utils/leadFormat';
import toast from 'react-hot-toast';
import { LuTriangleAlert, LuCalendarClock } from 'react-icons/lu';

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const Tile = ({ label, value }) => (
  <div className="panel p-4">
    <p className="field-label">{label}</p>
    <p className="text-2xl text-beam mt-1.5 num tabular">{value}</p>
  </div>
);

const TaskLine = ({ task, onOpen }) => (
  <button onClick={onOpen} className="block w-full text-left mt-3 cursor-pointer">
    <span className="text-sm text-ice">{task.title}</span>
    <span className="block text-xs text-dusk mt-0.5">
      Due {new Date(task.dueDate).toLocaleDateString()}
    </span>
  </button>
);

const SalesDashboard = () => {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState(null);
  const [overdue, setOverdue] = useState([]);
  const [dueToday, setDueToday] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        // One task request, split here. Asking the API for dueBefore=today would
        // also return everything overdue, putting the same task in both panels.
        const [pipe, sales] = await Promise.all([
          axiosInstance.get(API_PATHS.LEADS.GET_PIPELINE),
          axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, { params: { category: 'Sales' } }),
        ]);

        setPipeline(pipe.data);

        // category is a free string, so confirm the task really hangs off a lead.
        const live = (sales.data?.tasks || []).filter((task) => task.lead && task.status !== 'Completed');
        const start = startOfToday();
        const tomorrow = new Date(start.getTime() + 24 * 60 * 60 * 1000);

        setOverdue(live.filter((task) => new Date(task.dueDate) < start));
        setDueToday(live.filter((task) => {
          const due = new Date(task.dueDate);
          return due >= start && due < tomorrow;
        }));
      } catch (error) {
        toast.error(error.response?.data?.message || 'Failed to load the sales dashboard');
      }
    };
    load();
  }, []);

  if (!pipeline) {
    return (
      <DashboardLayout activeMenu="Sales">
        <div className="py-6"><div className="panel skeleton h-40" /></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activeMenu="Sales">
      <div className="py-6">
        <h2 className="font-display text-2xl text-beam">Sales</h2>
        <p className="text-sm text-mist mt-1.5">
          Where every open deal stands, and what needs a call today.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
          <Tile label="Leads" value={pipeline.totals.leads} />
          <Tile label="Follow-ups due" value={overdue.length + dueToday.length} />
          <Tile label="Pipeline" value={`₹${formatRupees(pipeline.totals.pipelineValue)}`} />
          <Tile label="Won" value={`₹${formatRupees(pipeline.totals.wonValue)}`} />
        </div>

        <div className="panel p-5 mt-4">
          <h3 className="font-display text-beam">Pipeline</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mt-4">
            {pipeline.stages.map((entry) => (
              <button
                key={entry.stage}
                onClick={() => navigate(`/sales/leads?stage=${entry.stage}`, { viewTransition: true })}
                className="panel-sunken p-3 text-left cursor-pointer"
              >
                <span className="block text-xl text-beam num tabular">{entry.count}</span>
                <span className={`chip ${stageChip(entry.stage)} mt-2`}>{entry.stage}</span>
                <span className="block text-xs text-dusk mt-2">₹{formatRupees(entry.value)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div className="panel p-5">
            <h3 className="font-display text-alert flex items-center gap-2">
              <LuTriangleAlert /> Overdue
            </h3>
            {overdue.length === 0
              ? <p className="text-sm text-dusk mt-3">Nothing overdue.</p>
              : overdue.map((task) => (
                <TaskLine
                  key={task._id}
                  task={task}
                  onOpen={() => navigate(`/sales/leads/${task.lead}`, { viewTransition: true })}
                />
              ))}
          </div>

          <div className="panel p-5">
            <h3 className="font-display text-beam flex items-center gap-2">
              <LuCalendarClock /> Today
            </h3>
            {dueToday.length === 0
              ? <p className="text-sm text-dusk mt-3">Nothing due today.</p>
              : dueToday.map((task) => (
                <TaskLine
                  key={task._id}
                  task={task}
                  onOpen={() => navigate(`/sales/leads/${task.lead}`, { viewTransition: true })}
                />
              ))}
          </div>
        </div>

        {/* Members get no per-rep table - the API omits it for them. */}
        {pipeline.owners && (
          <div className="panel p-5 mt-4">
            <h3 className="font-display text-beam">By salesperson</h3>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-dusk">
                    <th className="pb-2 font-normal">Salesperson</th>
                    <th className="pb-2 font-normal">Leads</th>
                    <th className="pb-2 font-normal">Pipeline</th>
                    <th className="pb-2 font-normal">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.owners.map((row, index) => (
                    <tr key={row.owner?._id || index} className="border-t border-seam">
                      <td className="py-2 text-ice">{row.owner?.name || 'Unassigned'}</td>
                      <td className="py-2 text-mist num tabular">{row.leads}</td>
                      <td className="py-2 text-mist num tabular">₹{formatRupees(row.pipelineValue)}</td>
                      <td className="py-2 text-done num tabular">₹{formatRupees(row.wonValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default SalesDashboard;

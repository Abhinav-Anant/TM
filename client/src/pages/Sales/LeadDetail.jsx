import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { STAGES, CLOSED_STAGES, OUTCOMES, stageChip, formatRupees } from '../../utils/leadFormat';
import toast from 'react-hot-toast';
import { LuArrowLeft, LuPhone, LuMail } from 'react-icons/lu';

const BLANK_OUTCOME = { taskId: '', outcome: 'Interested', note: '', nextFollowUp: '' };

const LeadDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [outcome, setOutcome] = useState(BLANK_OUTCOME);

  const loadLead = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get(API_PATHS.LEADS.GET_BY_ID(id));
      setLead(data.lead);
      setTasks(data.tasks || []);
      // Preselect the open follow-up, which is what a rep is almost always
      // closing out when they log a touch.
      const open = (data.tasks || []).find((task) => task.status !== 'Completed');
      setOutcome((previous) => ({ ...previous, taskId: open?._id || '' }));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to load the lead');
      navigate('/sales/leads');
    }
  }, [id, navigate]);

  useEffect(() => { loadLead(); }, [loadLead]);

  const moveStage = async (stage) => {
    try {
      await axiosInstance.put(API_PATHS.LEADS.UPDATE_STAGE(id), { stage });
      toast.success(`Moved to ${stage}`);
      loadLead();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to move the stage');
    }
  };

  const logOutcome = async (event) => {
    event.preventDefault();
    try {
      const { data } = await axiosInstance.post(API_PATHS.LEADS.LOG_OUTCOME(id), outcome);

      // The server suppresses a follow-up on a closed lead. Say so rather than
      // letting the rep assume one was scheduled.
      if (data.nextSkipped) toast(`Lead is ${data.lead.stage} - no follow-up scheduled`);
      else if (data.nextTask) toast.success(`Logged - next follow-up ${new Date(data.nextTask.dueDate).toLocaleDateString()}`);
      else toast.success('Outcome logged');

      setOutcome(BLANK_OUTCOME);
      loadLead();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to log the outcome');
    }
  };

  if (!lead) {
    return (
      <DashboardLayout activeMenu="Leads">
        <div className="py-6"><div className="panel skeleton h-40" /></div>
      </DashboardLayout>
    );
  }

  const closed = CLOSED_STAGES.includes(lead.stage);
  const openTasks = tasks.filter((task) => task.status !== 'Completed');

  return (
    <DashboardLayout activeMenu="Leads">
      <div className="py-6">
        <button
          onClick={() => navigate('/sales/leads', { viewTransition: true })}
          className="btn btn-sm mb-5"
        >
          <LuArrowLeft /> All leads
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl text-beam">{lead.company}</h2>
                  <p className="text-sm text-mist mt-1.5">
                    {lead.contactName || 'No contact name'} · {lead.product} · via {lead.source}
                  </p>
                  <div className="flex flex-wrap gap-4 mt-3 text-xs text-dusk">
                    {lead.phone && <span className="flex items-center gap-1.5"><LuPhone /> {lead.phone}</span>}
                    {lead.email && <span className="flex items-center gap-1.5"><LuMail /> {lead.email}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl text-ice">
                    ₹<span className="num tabular">{formatRupees(lead.value)}</span>
                  </p>
                  <span className={`chip ${stageChip(lead.stage)} mt-2`}>{lead.stage}</span>
                </div>
              </div>

              <div className="hairline my-4" />

              <p className="field-label">Move to</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {STAGES.map((stage) => (
                  <button
                    key={stage}
                    onClick={() => moveStage(stage)}
                    disabled={stage === lead.stage}
                    className={`chip ${stageChip(stage)} disabled:opacity-35 disabled:cursor-default cursor-pointer`}
                  >
                    {stage}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={logOutcome} className="panel p-5 flex flex-col gap-3">
              <h3 className="font-display text-beam">Log a touch</h3>

              <div>
                <label className="field-label" htmlFor="outcome-task">Closing which task</label>
                <div className="select-wrap mt-1.5">
                  <select
                    id="outcome-task"
                    value={outcome.taskId}
                    onChange={(event) => setOutcome({ ...outcome, taskId: event.target.value })}
                    className="field cursor-pointer"
                  >
                    <option value="">Do not close a task</option>
                    {openTasks.map((task) => (
                      <option key={task._id} value={task._id}>
                        {task.title} - due {new Date(task.dueDate).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="outcome-result">Result</label>
                <div className="select-wrap mt-1.5">
                  <select
                    id="outcome-result"
                    value={outcome.outcome}
                    onChange={(event) => setOutcome({ ...outcome, outcome: event.target.value })}
                    className="field cursor-pointer"
                  >
                    {OUTCOMES.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="outcome-note">What happened</label>
                <textarea
                  id="outcome-note"
                  value={outcome.note}
                  onChange={(event) => setOutcome({ ...outcome, note: event.target.value })}
                  rows={2}
                  className="field mt-1.5"
                />
              </div>

              <div>
                <label className="field-label" htmlFor="outcome-next">Next follow-up</label>
                <input
                  id="outcome-next"
                  type="date"
                  value={outcome.nextFollowUp}
                  onChange={(event) => setOutcome({ ...outcome, nextFollowUp: event.target.value })}
                  className="field mt-1.5"
                />
                {closed && (
                  <p className="text-xs text-dusk mt-1.5">
                    This lead is {lead.stage}, so no follow-up will be scheduled.
                  </p>
                )}
              </div>

              <button type="submit" className="btn btn-primary self-start">Log outcome</button>
            </form>
          </div>

          <div className="flex flex-col gap-4">
            <div className="panel p-5">
              <h3 className="font-display text-beam">Next actions</h3>
              {openTasks.length === 0 ? (
                <p className="text-sm text-dusk mt-3">Nothing scheduled.</p>
              ) : (
                openTasks.map((task) => (
                  <button
                    key={task._id}
                    onClick={() => navigate(`/user/task-details/${task._id}`, { viewTransition: true })}
                    className="block w-full text-left mt-3 cursor-pointer"
                  >
                    <span className="text-sm text-ice">{task.title}</span>
                    <span className="block text-xs text-dusk mt-0.5">
                      Due {new Date(task.dueDate).toLocaleDateString()}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="panel p-5">
              <h3 className="font-display text-beam">History</h3>
              {[...(lead.history || [])].reverse().map((entry, index) => (
                <div key={index} className="mt-3">
                  <p className="text-sm text-ice">{entry.text}</p>
                  <p className="text-xs text-dusk mt-0.5">
                    {new Date(entry.at).toLocaleDateString()} · {entry.by?.name || 'System'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default LeadDetail;

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { STAGES, PRODUCTS, SOURCES, stageChip, formatRupees } from '../../utils/leadFormat';
import toast from 'react-hot-toast';
import { LuPlus, LuInbox } from 'react-icons/lu';
import { tilt } from '../../utils/tilt';

const BLANK = { company: '', contactName: '', phone: '', email: '', product: 'Other', source: 'Other', value: '' };

const Leads = () => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [filters, setFilters] = useState({ stage: 'All', product: 'All', q: '' });
  const [form, setForm] = useState(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadLeads = useCallback(async () => {
    try {
      const params = {};
      if (filters.stage !== 'All') params.stage = filters.stage;
      if (filters.product !== 'All') params.product = filters.product;
      if (filters.q.trim()) params.q = filters.q.trim();

      const { data } = await axiosInstance.get(API_PATHS.LEADS.GET_ALL, { params });
      setLeads(data?.leads || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Debounced, so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(loadLeads, 250);
    return () => clearTimeout(timer);
  }, [loadLeads]);

  const createLead = async (event) => {
    event.preventDefault();
    if (!form.company.trim()) return toast.error('Company is required');

    try {
      const { data } = await axiosInstance.post(API_PATHS.LEADS.CREATE, form);
      // Every lead gets a first follow-up. Say so - the rep needs to know the
      // task is already sitting in their list.
      toast.success(`Lead added - follow up by ${new Date(data.task.dueDate).toLocaleDateString()}`);
      setForm(BLANK);
      setShowForm(false);
      loadLeads();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add the lead');
    }
  };

  const bind = (key) => ({
    value: form[key],
    onChange: (event) => setForm({ ...form, [key]: event.target.value }),
  });

  return (
    <DashboardLayout activeMenu="Leads">
      <div className="py-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-beam">Leads</h2>
            <p className="text-sm text-mist mt-1.5">
              Every lead carries a next action, so nothing goes quiet.
            </p>
          </div>
          <button onClick={() => setShowForm((open) => !open)} className="btn btn-primary shrink-0">
            {showForm ? 'Cancel' : <><LuPlus /> Add lead</>}
          </button>
        </div>

        {showForm && (
          <form onSubmit={createLead} className="panel p-4 mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input {...bind('company')} className="field" placeholder="Company" aria-label="Company" />
            <input {...bind('contactName')} className="field" placeholder="Contact name" aria-label="Contact name" />
            <input {...bind('phone')} className="field" placeholder="Phone" aria-label="Phone" />
            <input {...bind('email')} className="field" placeholder="Email" aria-label="Email" type="email" />
            <div className="select-wrap">
              <select {...bind('product')} className="field cursor-pointer" aria-label="Product">
                {PRODUCTS.map((product) => <option key={product} value={product}>{product}</option>)}
              </select>
            </div>
            <div className="select-wrap">
              <select {...bind('source')} className="field cursor-pointer" aria-label="Source">
                {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            </div>
            <input {...bind('value')} className="field" placeholder="Value in ₹" aria-label="Value in rupees" type="number" min="0" />
            <button type="submit" className="btn btn-primary md:col-start-3">Save lead</button>
          </form>
        )}

        <div className="flex flex-wrap gap-3 mt-5">
          <div className="select-wrap">
            <select
              value={filters.stage}
              onChange={(event) => setFilters({ ...filters, stage: event.target.value })}
              className="field cursor-pointer"
              aria-label="Filter by stage"
            >
              <option value="All">All stages</option>
              {STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </div>
          <div className="select-wrap">
            <select
              value={filters.product}
              onChange={(event) => setFilters({ ...filters, product: event.target.value })}
              className="field cursor-pointer"
              aria-label="Filter by product"
            >
              <option value="All">All products</option>
              {PRODUCTS.map((product) => <option key={product} value={product}>{product}</option>)}
            </select>
          </div>
          <input
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
            placeholder="Search company or contact"
            aria-label="Search leads"
            className="field flex-1 min-w-[200px]"
          />
        </div>

        {leads.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
            {leads.map((lead) => (
              <button
                key={lead._id}
                onClick={() => navigate(`/sales/leads/${lead._id}`, { viewTransition: true })}
                className="panel tilt relative overflow-hidden p-4 text-left cursor-pointer"
                {...tilt}
              >
                <span className="tilt-gloss" />

                <div className="relative tilt-layer">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-beam">{lead.company}</h3>
                    <span className={`chip ${stageChip(lead.stage)} shrink-0`}>{lead.stage}</span>
                  </div>

                  <p className="text-xs text-mist mt-2">
                    {lead.contactName || 'No contact yet'} · {lead.product}
                  </p>

                  <div className="flex items-baseline justify-between gap-3 mt-4">
                    <p className="text-lg text-ice">
                      ₹<span className="num tabular">{formatRupees(lead.value)}</span>
                    </p>
                    <p className="text-xs text-dusk">{lead.owner?.name || 'Unassigned'}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          !loading && (
            <div className="panel p-10 mt-6 grid place-items-center text-center">
              <LuInbox className="text-3xl text-dusk" />
              <p className="text-sm text-mist mt-3">No leads match these filters.</p>
            </div>
          )
        )}
      </div>
    </DashboardLayout>
  );
};

export default Leads;

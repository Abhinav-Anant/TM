import React, { useCallback, useEffect, useState } from 'react';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuFileSpreadsheet, LuFileText } from 'react-icons/lu';
import DashboardLayout from '../components/layouts/DashboardLayout';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';

const KINDS = [
  ['tasks', 'Tasks'],
  ['employees', 'Employees'],
  ['departments', 'Departments'],
  ['projects', 'Projects'],
];

const PRESETS = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['month', 'This month'],
  ['lastmonth', 'Last month'],
];

const TEXT_COLUMNS = ['name', 'email', 'departments', 'department', 'status', 'manager', 'dueDate']; // the rest are numbers
const DAY_FORMAT = 'YYYY-MM-DD';
const rangeFor = (preset) => {
  const today = moment();
  if (preset === 'month') return { from: today.clone().startOf('month').format(DAY_FORMAT), to: today.format(DAY_FORMAT) };
  if (preset === 'lastmonth') {
    const last = today.clone().subtract(1, 'month');
    return { from: last.startOf('month').format(DAY_FORMAT), to: last.endOf('month').format(DAY_FORMAT) };
  }
  return { from: today.clone().subtract(Number(preset) - 1, 'days').format(DAY_FORMAT), to: today.format(DAY_FORMAT) };
};

const Reports = () => {
  const [kind, setKind] = useState('tasks');
  const [range, setRange] = useState(() => rangeFor('30'));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = { ...range, tzOffset: new Date().getTimezoneOffset() };
  const usesRange = kind !== 'projects'; // projects are a snapshot of now

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.get(`${API_PATHS.REPORTS.BASE}/${kind}`, {
        params: { from: range.from, to: range.to, tzOffset: new Date().getTimezoneOffset() },
      });
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err.response?.data?.message || 'Could not build this report.');
    } finally {
      setLoading(false);
    }
  }, [kind, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const download = async (format) => {
    try {
      const response = await axiosInstance.get(`${API_PATHS.REPORTS.BASE}/${kind}`, { params: { ...params, format }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${kind}-report.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download the report. Try again in a moment.');
    }
  };

  const cell = (value, column) => {
    if (value === null || value === undefined) return '–';
    if (column.key === 'onTimeRate' || column.key === 'progress') return `${value}%`;
    return value;
  };

  return (
    <DashboardLayout activeMenu="Reports">
      <div className="py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-beam">Reports</h2>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => download('csv')} disabled={!report}><LuFileText /> CSV</button>
            <button className="btn btn-sm" onClick={() => download('xlsx')} disabled={!report}><LuFileSpreadsheet /> Excel</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="max-w-full overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1 p-1 rounded-xl panel-sunken w-max" role="tablist">
              {KINDS.map(([id, label]) => (
                <button
                  key={id} role="tab" aria-selected={kind === id} onClick={() => setKind(id)}
                  className={`relative px-3.5 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${kind === id ? 'text-ink' : 'text-mist hover:text-beam'}`}
                >
                  {kind === id && <span className="absolute inset-0 rounded-lg bg-signal" />}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={`flex flex-wrap items-end gap-2 ${usesRange ? '' : 'opacity-50'}`}>
            <label className="text-xs text-mist">
              Quick range
              <select className="field py-2 mt-1" disabled={!usesRange} defaultValue="30" onChange={(e) => setRange(rangeFor(e.target.value))}>
                {PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs text-mist">
              From
              <input type="date" className="field py-2 mt-1" disabled={!usesRange} value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
            </label>
            <label className="text-xs text-mist">
              To
              <input type="date" className="field py-2 mt-1" disabled={!usesRange} value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
            </label>
          </div>
        </div>

        {!usesRange && <p className="text-xs text-dusk mt-2">Projects show where things stand right now, so the date range does not apply.</p>}
        {usesRange && kind === 'tasks' && <p className="text-xs text-dusk mt-2">Created and completed follow the dates above. Open, overdue and blocked are the position right now.</p>}

        {error && <p role="alert" className="chip chip-alert mt-4 w-full justify-start">{error}</p>}

        {loading ? (
          <div className="skeleton h-64 mt-4" />
        ) : report && (
          <>
            {kind === 'tasks' && (
              <section aria-label="Task totals" className="grid grid-cols-2 lg:grid-cols-5 gap-4 mt-4">
                {report.rows.map((row) => (
                  <div key={row.metric} className="panel p-5">
                    <p className="text-[11px] uppercase tracking-wide text-dusk">{row.metric}</p>
                    <p className={`font-display text-3xl num mt-1 ${row.metric === 'Overdue' && row.count ? 'text-alert' : row.metric === 'Blocked' && row.count ? 'text-signal' : 'text-beam'}`}>{row.count}</p>
                  </div>
                ))}
              </section>
            )}

            {kind === 'tasks' ? (
              <section className="panel p-5 mt-4">
                <h3 className="font-display text-base text-beam">Per day</h3>
                <div className="overflow-auto max-h-96 mt-3">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-hull text-left text-xs text-dusk">
                      <tr><th className="py-2 pr-4 font-medium">Date</th><th className="py-2 px-4 font-medium text-right">Created</th><th className="py-2 pl-4 font-medium text-right">Completed</th></tr>
                    </thead>
                    <tbody>
                      {report.trend.map((d) => (
                        <tr key={d.date} className="border-t border-white/8">
                          <td className="py-2 pr-4 text-beam num">{moment(d.date).format('ddd D MMM')}</td>
                          <td className={`py-2 px-4 text-right num ${d.created ? 'text-beam' : 'text-dusk'}`}>{d.created}</td>
                          <td className={`py-2 pl-4 text-right num ${d.completed ? 'text-done' : 'text-dusk'}`}>{d.completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className="panel p-5 mt-4">
                {report.rows.length === 0 ? (
                  <p className="text-sm text-dusk py-6 text-center">Nothing to report yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-dusk">
                          {report.columns.map((c) => (
                            <th key={c.key} scope="col" className={`py-2 font-medium ${TEXT_COLUMNS.includes(c.key) ? 'pr-4' : 'px-3 text-right'}`}>{c.header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((row, r) => (
                          <tr key={`${row.name}-${r}`} className="border-t border-white/8">
                            {report.columns.map((c, i) => (
                              <td key={c.key} className={`py-2.5 ${i === 0 ? 'pr-4 text-beam' : TEXT_COLUMNS.includes(c.key) ? 'pr-4 text-mist' : 'px-3 text-right num text-mist'} ${c.key === 'overdue' && row[c.key] ? 'text-alert font-medium' : ''}`}>
                                {cell(row[c.key], c)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {report.totals && (
                        <tfoot>
                          <tr className="border-t border-white/20 font-medium">
                            {report.columns.map((c) => (
                              <td key={c.key} className={`py-2.5 ${TEXT_COLUMNS.includes(c.key) ? 'pr-4 text-beam' : 'px-3 text-right num text-beam'}`}>{report.totals[c.key] ?? ''}</td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Reports;

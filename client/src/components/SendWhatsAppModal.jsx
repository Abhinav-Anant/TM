import React, { useEffect, useState } from 'react';
import { LuSend } from 'react-icons/lu';
import toast from 'react-hot-toast';
import Modal from './layouts/Modal';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';

/** Admin: a WhatsApp to everyone, one department, or chosen people. From the admin's own phone if linked. */
const SendWhatsAppModal = ({ isOpen, onClose, people }) => {
  const [to, setTo] = useState('everyone');
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!isOpen || departments.length) return;
    axiosInstance.get(API_PATHS.DEPARTMENTS.GET_ALL)
      .then(({ data }) => setDepartments(data.departments || []))
      .catch(() => {});
  }, [isOpen, departments.length]);

  const toggle = (id) => setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const send = async (e) => {
    e.preventDefault();
    const audience = to === 'everyone' ? { everyone: true }
      : to === 'department' ? { departmentId }
      : { userIds: picked };
    setSending(true);
    try {
      const { data } = await axiosInstance.post(API_PATHS.WHATSAPP.SEND, { text, ...audience });
      toast.success(`Sending to ${data.queued} ${data.queued === 1 ? 'person' : 'people'} from ${data.from}`);
      if (data.noNumber?.length) toast(`No WhatsApp number on file: ${data.noNumber.join(', ')}`);
      setText('');
      onClose();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'The message was not sent');
    } finally {
      setSending(false);
    }
  };

  const ready = text.trim() && (to === 'everyone' || (to === 'department' ? departmentId : picked.length));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send a WhatsApp message">
      <form onSubmit={send} className="space-y-4">
        <fieldset>
          <legend className="field-label">To</legend>
          <div className="flex flex-wrap gap-2">
            {[['everyone', 'Everyone'], ['department', 'A department'], ['people', 'Chosen people']].map(([value, label]) => (
              <label key={value} className={`chip cursor-pointer ${to === value ? 'chip-signal' : ''}`}>
                <input type="radio" name="wa-to" value={value} checked={to === value} onChange={() => setTo(value)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {to === 'department' && (
          <select className="field" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
            <option value="">Pick a department</option>
            {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
          </select>
        )}

        {to === 'people' && (
          <div className="panel-sunken rounded-lg p-2 max-h-48 overflow-y-auto">
            {people.map((p) => (
              <label key={p._id} className="flex items-center gap-2 px-2 py-1.5 text-sm text-mist cursor-pointer">
                <input type="checkbox" checked={picked.includes(p._id)} onChange={() => toggle(p._id)} />
                <span className="text-beam">{p.name}</span>
                {!p.phone && <span className="text-xs text-dusk">(no number)</span>}
              </label>
            ))}
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="wa-text">Message</label>
          <textarea
            id="wa-text" className="field" rows={4} maxLength={2000} value={text}
            onChange={(e) => setText(e.target.value)} placeholder="Team meeting at 5 in the conference room"
          />
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={!ready || sending}>
            <LuSend /> {sending ? 'Sending' : 'Send'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default SendWhatsAppModal;

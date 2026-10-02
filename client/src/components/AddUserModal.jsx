import React, { useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import Modal from './layouts/Modal';
import Input from '../customcomponent/Input';

const EMPTY = { name: '', email: '', phone: '', password: '', role: 'member', department: '', head: false };

/**
 * Admin creates one person directly - any role, optionally straight into a
 * department. The server enforces the department rules; this form only hides
 * the choices that can never be valid (an admin in a department, a member as head).
 */
const AddUserModal = ({ isOpen, onClose, onCreated }) => {
  const [form, setForm] = useState(EMPTY);
  const [departments, setDepartments] = useState([]);
  const [saving, setSaving] = useState(false);
  const roleId = useId();
  const deptId = useId();

  useEffect(() => {
    if (!isOpen) return;
    axiosInstance.get(API_PATHS.DEPARTMENTS.GET_ALL)
      .then((res) => setDepartments(res.data?.departments || []))
      .catch(() => setDepartments([]));
  }, [isOpen]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const close = () => { setForm(EMPTY); onClose(); };

  const submit = async (e) => {
    e.preventDefault();
    const inDepartment = form.role !== 'admin' && form.department;
    setSaving(true);
    try {
      const { data } = await axiosInstance.post(API_PATHS.USERS.CREATE_USER, {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
        role: form.role,
        department: inDepartment ? form.department : undefined,
        head: inDepartment && form.role === 'head' ? form.head : false,
      });
      toast.success(data.message || 'User created');
      onCreated?.(data.user);
      close();
    } catch (error) {
      // Keep the form filled in so the admin only fixes what was wrong.
      toast.error(error.response?.data?.message || 'Could not create the user. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Add a user">
      <form onSubmit={submit} autoComplete="off">
        <Input label="Full name" type="text" name="name" value={form.name} onChange={set('name')} required autoComplete="off" />
        {/* It is someone else's address, so the admin's own email must not autofill here. */}
        <Input label="Email" type="email" name="email" value={form.email} onChange={set('email')} required autoComplete="off" />
        <Input
          label="WhatsApp number (optional)" type="tel" name="phone" inputMode="tel"
          placeholder="98765 43210" value={form.phone} onChange={set('phone')} autoComplete="off"
        />
        <Input
          label="Initial password" type="password" name="new-password" value={form.password}
          onChange={set('password')} required minLength={6} autoComplete="new-password"
          placeholder="At least 6 characters - share it with them"
        />

        <div className="mb-5">
          <label htmlFor={roleId} className="field-label">Role</label>
          <select id={roleId} value={form.role} onChange={set('role')} className="field py-2 cursor-pointer">
            <option value="member">Member</option>
            <option value="head">Head</option>
            <option value="admin">Admin</option>
          </select>
          {form.role === 'admin' && (
            <p className="text-xs text-mist mt-1.5">Admins see and manage everything and are not placed in a department.</p>
          )}
        </div>

        {form.role !== 'admin' && (
          <div className="mb-5">
            <label htmlFor={deptId} className="field-label">Department (optional)</label>
            <select id={deptId} value={form.department} onChange={set('department')} className="field py-2 cursor-pointer">
              <option value="">No department yet</option>
              {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
            {form.role === 'head' && form.department && (
              <label className="flex items-center gap-2 text-sm text-mist mt-3 cursor-pointer">
                <input type="checkbox" checked={form.head} onChange={set('head')} className="accent-[#7fc7ff] cursor-pointer" />
                Make head of this department
              </label>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating' : 'Create user'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default AddUserModal;

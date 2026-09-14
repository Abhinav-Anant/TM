import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import toast from 'react-hot-toast';
import { LuTrash2, LuPlus, LuUsers, LuPencil } from 'react-icons/lu';

const roleLabel = { head: 'Head of Department', member: 'Member' };

const ManageDepartments = () => {
  const [departments, setDepartments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState(null); // { department, members }
  const [addUserId, setAddUserId] = useState('');

  const loadDepartments = async () => {
    try {
      const { data } = await axiosInstance.get(API_PATHS.DEPARTMENTS.GET_ALL);
      setDepartments(data?.departments || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to load departments');
    }
  };

  const loadUsers = async () => {
    try {
      const { data } = await axiosInstance.get(API_PATHS.USERS.GET_ALL_USERS);
      setAssignableUsers(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const openDepartment = async (id) => {
    try {
      const { data } = await axiosInstance.get(API_PATHS.DEPARTMENTS.GET_MEMBERS(id));
      setSelected(data);
      setAddUserId('');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to load members');
    }
  };

  const createDepartment = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return;
    try {
      await axiosInstance.post(API_PATHS.DEPARTMENTS.CREATE, { name: newName.trim() });
      toast.success('Department created');
      setNewName('');
      loadDepartments();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create department');
    }
  };

  const renameDepartment = async (department) => {
    const name = window.prompt('New department name', department.name);
    if (!name || !name.trim() || name === department.name) return;
    try {
      await axiosInstance.put(API_PATHS.DEPARTMENTS.UPDATE(department._id), { name: name.trim() });
      toast.success('Department renamed');
      loadDepartments();
      if (selected?.department?._id === department._id) openDepartment(department._id);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to rename department');
    }
  };

  const deleteDepartment = async (department) => {
    const warning = 'Delete "' + department.name + '"? Its members will be left without a department.';
    if (!window.confirm(warning)) return;
    try {
      await axiosInstance.delete(API_PATHS.DEPARTMENTS.DELETE(department._id));
      toast.success('Department deleted');
      if (selected?.department?._id === department._id) setSelected(null);
      loadDepartments();
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete department');
    }
  };

  const addMember = async () => {
    if (!addUserId) return;
    try {
      await axiosInstance.post(
        API_PATHS.DEPARTMENTS.ADD_MEMBER(selected.department._id),
        { userId: addUserId }
      );
      toast.success('Member added');
      openDepartment(selected.department._id);
      loadDepartments();
      loadUsers();
    } catch (error) {
      // A 409 here means the department already has a head.
      toast.error(error.response?.data?.message || 'Failed to add member');
    }
  };

  const removeMember = async (userId) => {
    try {
      await axiosInstance.delete(
        API_PATHS.DEPARTMENTS.REMOVE_MEMBER(selected.department._id, userId)
      );
      toast.success('Member removed');
      openDepartment(selected.department._id);
      loadDepartments();
      loadUsers();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to remove member');
    }
  };

  useEffect(() => {
    loadDepartments();
    loadUsers();
  }, []);

  // Anyone not already in the department being viewed.
  const selectedId = String(selected?.department?._id || '');
  const candidates = assignableUsers.filter(
    (user) => String(user.department?._id || user.department || '') !== selectedId
  );

  return (
    <DashboardLayout activeMenu="Departments">
      <div className="mt-5 mb-10">
        <h2 className="text-xl font-medium">Departments</h2>

        <form onSubmit={createDepartment} className="flex gap-2 mt-4">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New department name"
            className="border border-gray-200 rounded px-3 py-2 text-sm w-full md:w-72"
          />
          <button
            type="submit"
            className="flex items-center gap-1 bg-blue-500 text-white rounded px-4 py-2 text-sm"
          >
            <LuPlus className="text-lg" /> Add
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          {departments.map((department) => (
            <div
              key={department._id}
              className="bg-white p-4 rounded-lg shadow-md shadow-gray-100 border border-gray-200/50"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{department.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => renameDepartment(department)}
                    aria-label={`Rename ${department.name}`}
                  >
                    <LuPencil className="text-gray-400 hover:text-blue-500" />
                  </button>
                  <button
                    onClick={() => deleteDepartment(department)}
                    aria-label={`Delete ${department.name}`}
                  >
                    <LuTrash2 className="text-gray-400 hover:text-rose-500" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <LuUsers /> {department.memberCount} member{department.memberCount === 1 ? '' : 's'}
              </p>
              <button
                onClick={() => openDepartment(department._id)}
                className="text-xs text-blue-500 mt-3"
              >
                Manage members
              </button>
            </div>
          ))}
          {departments.length === 0 && (
            <p className="text-sm text-gray-500">No departments yet. Create one above.</p>
          )}
        </div>

        {selected && (
          <div className="mt-8 bg-white p-4 rounded-lg shadow-md shadow-gray-100 border border-gray-200/50">
            <h3 className="font-medium">{selected.department.name} &mdash; members</h3>

            <div className="flex gap-2 mt-4">
              <select
                value={addUserId}
                onChange={(event) => setAddUserId(event.target.value)}
                className="border border-gray-200 rounded px-3 py-2 text-sm w-full md:w-72"
              >
                <option value="">Select a person to add...</option>
                {candidates.map((user) => (
                  <option key={user._id} value={user._id}>
                    {user.name} ({roleLabel[user.role] || user.role})
                  </option>
                ))}
              </select>
              <button
                onClick={addMember}
                className="bg-blue-500 text-white rounded px-4 py-2 text-sm"
              >
                Add
              </button>
            </div>

            <ul className="mt-4 divide-y divide-gray-100">
              {selected.members.map((member) => (
                <li key={member._id} className="flex items-center justify-between py-2">
                  <span className="text-sm">
                    {member.name}
                    <span className="text-xs text-gray-500 ml-2">
                      {roleLabel[member.role] || member.role}
                    </span>
                  </span>
                  <button onClick={() => removeMember(member._id)} className="text-xs text-rose-500">
                    Remove
                  </button>
                </li>
              ))}
              {selected.members.length === 0 && (
                <li className="text-sm text-gray-500 py-2">No members yet.</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ManageDepartments;

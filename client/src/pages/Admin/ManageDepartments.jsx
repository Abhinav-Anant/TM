import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import toast from 'react-hot-toast';
import { LuTrash2, LuPlus, LuUsers, LuPencil } from 'react-icons/lu';
import { tilt } from '../../utils/tilt';

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
      <div className="py-6">
        <h2 className="font-display text-2xl text-beam">Departments</h2>
        <p className="text-sm text-mist mt-1.5">
          Group the team so heads only see their own people and their own work.
        </p>

        <form onSubmit={createDepartment} className="flex flex-wrap gap-3 mt-5">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New department name"
            aria-label="New department name"
            className="field w-full sm:w-80"
          />
          <button type="submit" className="btn btn-primary shrink-0">
            <LuPlus /> Add department
          </button>
        </form>

        {departments.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
            {departments.map((department) => {
              const isOpen = String(selected?.department?._id || '') === String(department._id);
              return (
                <div
                  key={department._id}
                  className={`panel tilt relative overflow-hidden p-4 ${
                    isOpen ? 'border-signal/40' : ''
                  }`}
                  {...tilt}
                >
                  <span className="tilt-gloss" />

                  <div className="relative tilt-layer">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-beam">{department.name}</h3>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => renameDepartment(department)}
                          aria-label={`Rename ${department.name}`}
                          className="grid place-items-center w-8 h-8 rounded-lg text-dusk hover:text-ice hover:bg-white/8 transition-colors cursor-pointer"
                        >
                          <LuPencil />
                        </button>
                        <button
                          onClick={() => deleteDepartment(department)}
                          aria-label={`Delete ${department.name}`}
                          className="grid place-items-center w-8 h-8 rounded-lg text-dusk hover:text-alert hover:bg-white/8 transition-colors cursor-pointer"
                        >
                          <LuTrash2 />
                        </button>
                      </div>
                    </div>

                    <p className="flex items-center gap-1.5 text-xs text-mist mt-2">
                      <LuUsers />
                      <span className="num">{department.memberCount}</span>
                      member{department.memberCount === 1 ? '' : 's'}
                    </p>

                    <button
                      onClick={() => openDepartment(department._id)}
                      className="btn btn-sm mt-4"
                    >
                      {isOpen ? 'Viewing members' : 'Manage members'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="panel p-12 mt-6 text-center">
            <p className="text-beam">No departments yet.</p>
            <p className="text-sm text-mist mt-1">Name one above to get started.</p>
          </div>
        )}

        {selected && (
          <div className="enter-depth panel panel-raised p-6 mt-6">
            <h3 className="font-display text-lg text-beam">
              Members of {selected.department.name}
            </h3>

            <div className="flex flex-wrap gap-3 mt-4">
              <div className="select-wrap w-full sm:w-80">
                <select
                  value={addUserId}
                  onChange={(event) => setAddUserId(event.target.value)}
                  aria-label="Person to add"
                  className="field cursor-pointer"
                >
                  <option value="">Choose someone to add</option>
                  {candidates.map((user) => (
                    <option key={user._id} value={user._id}>
                      {user.name} ({roleLabel[user.role] || user.role})
                    </option>
                  ))}
                </select>
              </div>
              <button onClick={addMember} className="btn shrink-0">
                Add to department
              </button>
            </div>

            <ul className="mt-5 space-y-1.5">
              {selected.members.map((member) => (
                <li
                  key={member._id}
                  className="group flex items-center justify-between gap-3 panel-sunken rounded-lg px-3.5 py-2.5"
                >
                  <span className="text-sm text-beam min-w-0 truncate">
                    {member.name}
                    <span className="chip chip-mist ml-2">
                      {roleLabel[member.role] || member.role}
                    </span>
                  </span>
                  <button
                    onClick={() => removeMember(member._id)}
                    className="text-xs text-dusk hover:text-alert opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer shrink-0"
                  >
                    Remove
                  </button>
                </li>
              ))}
              {selected.members.length === 0 && (
                <li className="text-sm text-dusk py-2">
                  Nobody here yet. Add someone with the picker above.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ManageDepartments;

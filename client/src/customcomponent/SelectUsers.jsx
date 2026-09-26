import React, { useEffect, useState } from 'react';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { LuUsers } from 'react-icons/lu';
import Modal from '../components/layouts/Modal';
import AvatarGroup from '../components/layouts/AvatarGroup';

const SelectUsers = ({ selectedUsers, setSelectedUsers }) => {
  const [allUsers, setAllUsers] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempSelectedUsers, setTempSelectedUsers] = useState([]);

  const getAllUsers = async () => {
    try {
      const response = await axiosInstance.get(API_PATHS.USERS.GET_ALL_USERS);
      if (response.data?.length > 0) {
        setAllUsers(response.data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const toggleUserSelection = (userId) => {
    setTempSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleAssign = () => {
    setSelectedUsers(tempSelectedUsers);
    setIsModalOpen(false);
  };

  const selectedUserAvatars = allUsers
    .filter((user) => selectedUsers.includes(user._id))
    .map((user) => user.profileImageUrl);

  useEffect(() => {
    getAllUsers();
  }, []);

  useEffect(() => {
    setTempSelectedUsers(selectedUsers); // Sync temp selection with parent prop
  }, [selectedUsers]);

  return (
    <div className="space-y-4 mt-2">
      {/* Display add members button or selected avatars */}
      {selectedUserAvatars.length === 0 ? (
        <button type="button" className="btn btn-sm" onClick={() => setIsModalOpen(true)}>
          <LuUsers className="text-sm" /> Add Members
        </button>
      ) : (
        <div className="cursor-pointer" onClick={() => setIsModalOpen(true)}>
          <AvatarGroup avatars={selectedUserAvatars} maxVisible={3} />
        </div>
      )}

      {/* Modal to select users */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Assign people">
        <div className="space-y-1 max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {allUsers.length > 0 ? (
            allUsers.map((user) => (
              <div key={user._id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors">
                {user.profileImageUrl ? (
                  <img src={user.profileImageUrl} alt="" className="w-10 h-10 rounded-full object-cover bg-deck border border-white/10" />
                ) : (
                  <div className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-deck border border-white/10 font-display text-ice">
                    {user.name?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium text-beam">{user.name}</p>
                  <p className="text-xs text-dusk">{user.email}</p>
                </div>
                <input
                  type="checkbox"
                  checked={tempSelectedUsers.includes(user._id)}
                  onChange={() => toggleUserSelection(user._id)}
                  aria-label={`Assign ${user.name}`}
                  className="w-4 h-4 rounded-sm shrink-0"
                />
              </div>
            ))
          ) : (
            <p className="text-center text-dusk py-8">No users found.</p>
          )}
        </div>

        {/* Modal footer with action buttons */}
        <div className="flex justify-end gap-3 pt-5 mt-2 border-t border-white/8">
          <button className="btn" onClick={() => setIsModalOpen(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleAssign}>
            Done
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default SelectUsers;

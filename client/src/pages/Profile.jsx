import React, { useContext, useEffect, useState } from 'react';
import { LuSmartphone } from 'react-icons/lu';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/layouts/DashboardLayout';
import { UserContext } from '../context/userContext';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';

/**
 * Where a member puts the number their task alerts go to. Deliberately the only
 * place the number can be edited, so there is one screen to reason about rather
 * than a field duplicated across the portal.
 */
const Profile = () => {
  const { user, updatedUser } = useContext(UserContext);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  // The context starts null on a hard refresh and fills in once /profile
  // returns, so seed the form from it rather than from the first render.
  useEffect(() => {
    if (!user) return;
    setName(user.name || '');
    setPhone(user.phone || '');
  }, [user]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await axiosInstance.put(API_PATHS.AUTH.UPDATE_PROFILE, { name, phone });
      // The server returns the number it actually stored, which is the
      // normalised form - show that back rather than what was typed.
      updatedUser({ ...user, ...response.data });
      setPhone(response.data.phone || '');
      toast.success('Profile saved');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout activeMenu="Profile">
      <div className="mt-5 max-w-lg">
        <h2 className="text-xl md:text-xl font-medium">My Profile</h2>

        <form className="card mt-4 p-5" onSubmit={handleSave}>
          <div className="mb-4">
            <label className="text-[13px] text-slate-800" htmlFor="profile-name">Name</label>
            <input
              id="profile-name"
              type="text"
              className="form-input w-full mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="mb-2">
            <label className="text-[13px] text-slate-800" htmlFor="profile-phone">
              WhatsApp number
            </label>
            <input
              id="profile-phone"
              type="tel"
              className="form-input w-full mt-1"
              placeholder="9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-[12px] text-slate-500 mt-2">
              Task alerts are sent here on WhatsApp. A 10-digit number is assumed to be
              Indian; include <span className="font-medium">+countrycode</span> otherwise.
              Leave it empty to receive alerts in the app only.
            </p>
          </div>

          <div className="flex items-center gap-3 mt-5">
            <button type="submit" className="add-btn" disabled={saving}>
              <LuSmartphone className="text-lg" />
              {saving ? 'Saving...' : 'Save'}
            </button>
            <span className="text-[12px] text-slate-500">{user?.email}</span>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
};

export default Profile;

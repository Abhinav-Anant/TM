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
    // Must match the sidebar label exactly, or the nav item never highlights.
    <DashboardLayout activeMenu="My Profile">
      <div className="py-6 max-w-xl">
        <h2 className="font-display text-2xl text-beam">My profile</h2>
        <p className="text-sm text-mist mt-1.5">
          Your name as the team sees it, and where your task alerts go.
        </p>

        <form className="panel p-6 mt-5" onSubmit={handleSave}>
          <div className="mb-5">
            <label className="field-label" htmlFor="profile-name">Name</label>
            <input
              id="profile-name"
              type="text"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="profile-phone">WhatsApp number</label>
            <input
              id="profile-phone"
              type="tel"
              className="field num"
              placeholder="9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-describedby="profile-phone-help"
            />
            <p id="profile-phone-help" className="text-xs text-dusk mt-2 leading-relaxed">
              A 10-digit number is treated as Indian; include the{' '}
              <span className="text-mist">+country code</span> otherwise. Leave it empty to get
              alerts in the app only.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mt-7 pt-5 border-t border-white/8">
            <span className="text-xs text-dusk break-all">{user?.email}</span>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <LuSmartphone />
              {saving ? 'Saving' : 'Save profile'}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
};

export default Profile;

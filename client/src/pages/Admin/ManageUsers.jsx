import React, { useState } from 'react'
import DashboardLayout from '../../components/layouts/DashboardLayout'
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { LuFileSpreadsheet, LuUpload, LuDownload, LuUserPlus } from 'react-icons/lu';
import UserCard from '../../components/Cards/UserCard';
import { useContext } from 'react';
import { UserContext } from '../../context/userContext';
import Modal from '../../components/layouts/Modal';
import AddUserModal from '../../components/AddUserModal';

const ManageUsers = () => {
  const { user } = useContext(UserContext);
  const [allUsers, setAllUsers] = useState([]);
  const [openAdd, setOpenAdd] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const getAllUsers = async () => {
    try {
      const response = await axiosInstance.get(API_PATHS.USERS.GET_ALL_USERS);
      if (response.data?.length > 0) {
        setAllUsers(response.data)
      }

    } catch (error) {
      console.error("Error fetching users:", error)

    }
  }

  // download task report
  const handleDownloadReport = async () => {
    try {
      const response = await axiosInstance.get(API_PATHS.REPORTS.EXPORT_USERS, {
        responseType: 'blob',
      });

      // create a URL for the blob
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");

      link.href = url;
      link.setAttribute('download', 'users_report.xlsx');
      document.body.appendChild(link);
      link.click();

      // clean up
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading task details:", error);
      toast.error("Could not build the report. Try again in a moment.");
    }
  };

  const closeImport = () => {
    setOpenImport(false);
    setCsvFile(null);
    setResult(null);
  };

  const handleImport = async () => {
    if (!csvFile) return toast.error("Choose a CSV file first.");

    const formData = new FormData();
    formData.append("file", csvFile);

    setImporting(true);
    setResult(null);
    try {
      const response = await axiosInstance.post(API_PATHS.USERS.IMPORT_MEMBERS, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        // Hashing every row takes far longer than the 10s default on the instance.
        timeout: 120000,
      });

      setResult(response.data);
      toast.success(response.data.message);
      getAllUsers();
    } catch (error) {
      const data = error.response?.data;
      if (data?.errors) setResult(data);
      toast.error(data?.message || "The import did not run. Check the file and try again.");
    } finally {
      setImporting(false);
    }
  };


  useEffect(() => {
    getAllUsers();

    return () => { }
  }, [])




  return (
    <DashboardLayout activeMenu={user?.role === 'head' ? 'My Department' : 'Team Members'}>
      <div className='py-6'>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <h2 className='font-display text-2xl text-beam'>
            {user?.role === 'head' ? 'My department' : 'Team members'}
          </h2>

          {/* Both the users export and the member import are org-wide, admin-only endpoints. */}
          {user?.role === 'admin' && (
            <div className='flex flex-wrap items-center gap-2'>
              <button className='btn btn-sm btn-primary' onClick={() => setOpenAdd(true)}>
                <LuUserPlus /> Add user
              </button>

              <button className='btn btn-sm' onClick={() => setOpenImport(true)}>
                <LuUpload /> Import CSV
              </button>

              <button className='btn btn-sm' onClick={handleDownloadReport}>
                <LuFileSpreadsheet /> Download report
              </button>
            </div>
          )}
        </div>

        {allUsers.length > 0 ? (
          <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-5'>
            {allUsers.map((member) => (
              <UserCard key={member._id} userInfo={member} />
            ))}
          </div>
        ) : (
          <div className='panel p-12 mt-5 text-center'>
            <p className='text-beam'>No one here yet.</p>
            <p className='text-sm text-mist mt-1'>
              {user?.role === 'admin'
                ? 'Add people one at a time, or import a CSV to add your team in one go.'
                : 'Members assigned to your department will appear here.'}
            </p>
          </div>
        )}
      </div>

      <AddUserModal isOpen={openAdd} onClose={() => setOpenAdd(false)} onCreated={getAllUsers} />

      <Modal isOpen={openImport} onClose={closeImport} title="Import members from a CSV">
        <div className='space-y-5'>
          <p className='text-sm text-mist leading-relaxed'>
            The file needs the columns <b className='text-beam'>name</b>,{' '}
            <b className='text-beam'>email</b> and <b className='text-beam'>password</b> (at least
            6 characters), plus an optional <b className='text-beam'>department</b> holding an
            existing department name. Everyone is added as a member, emails that already exist are
            skipped, and up to 200 rows go through at a time.
          </p>

          <a
            href='/sample-members.csv'
            download
            className='inline-flex items-center gap-2 text-sm text-ice hover:text-signal underline underline-offset-4 transition-colors'
          >
            <LuDownload /> Download a sample CSV
          </a>

          <input
            type='file'
            accept='.csv,text/csv'
            onChange={(e) => { setCsvFile(e.target.files?.[0] || null); setResult(null); }}
            className='field cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:text-beam file:cursor-pointer'
          />

          {result && (
            <div className='panel-sunken rounded-lg p-3.5 text-sm'>
              <div className='flex flex-wrap gap-2'>
                <span className='chip chip-done'>{result.created || 0} created</span>
                <span className='chip chip-mist'>{result.skipped || 0} already existed</span>
                <span className='chip chip-alert'>
                  {result.failed ?? result.errors?.length ?? 0} failed
                </span>
              </div>

              {result.errors?.length > 0 && (
                <ul className='mt-3 max-h-40 overflow-y-auto space-y-1 text-xs text-alert'>
                  {result.errors.map((err, i) => (
                    <li key={i}>{err.line ? `Line ${err.line}: ` : ''}{err.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className='flex justify-end gap-3 pt-2'>
            <button className='btn' onClick={closeImport}>Close</button>
            <button className='btn btn-primary' onClick={handleImport} disabled={importing}>
              {importing ? 'Importing' : 'Import members'}
            </button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  )
}

export default ManageUsers

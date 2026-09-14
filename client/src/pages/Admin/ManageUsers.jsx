import React, { useState } from 'react'
import DashboardLayout from '../../components/layouts/DashboardLayout'
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { LuFileSpreadsheet, LuUpload, LuDownload } from 'react-icons/lu';
import UserCard from '../../components/Cards/UserCard';
import { useContext } from 'react';
import { UserContext } from '../../context/userContext';
import Modal from '../../components/layouts/Modal';

const ManageUsers = () => {
  const { user } = useContext(UserContext);
  const [allUsers, setAllUsers] = useState([]);
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
      toast.error("Failed to download task details. Please try again.");
    }
  };

  const closeImport = () => {
    setOpenImport(false);
    setCsvFile(null);
    setResult(null);
  };

  const handleImport = async () => {
    if (!csvFile) return toast.error("Please choose a CSV file.");

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
      toast.error(data?.message || "Import failed. Please try again.");
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
      <div className='mt-5 mb-10'>
        <div className='flex md:flex-row md:items-center justify-between'>
          <h2 className='text-xl md:text:xl font-medium'>
            {user?.role === 'head' ? 'My Department' : 'Team Members'}
          </h2>

          {/* Both the users export and the member import are org-wide, admin-only endpoints. */}
          {user?.role === 'admin' && (
            <div className='flex items-center gap-2'>
              <button className='flex md:flex download-btn'
                onClick={() => setOpenImport(true)}
              >
                <LuUpload className='text-lg' />
                Import CSV
              </button>

              <button className='flex md:flex download-btn '
                onClick={handleDownloadReport}
              >
                <LuFileSpreadsheet className='text-lg' />
                Download Report
              </button>
            </div>
          )}
        </div>

        <div className='grid grid-cols-1 md:grid-cols-3 gap-4 mt-4  '>
          {allUsers?.map((user) => (
            <UserCard key={user._id} userInfo={user} />
          ))}
        </div>


      </div>

      <Modal isOpen={openImport} onClose={closeImport} title="Import Members from CSV">
        <p className='text-sm text-gray-600'>
          Upload a CSV with the columns <b>name</b>, <b>email</b> and <b>password</b> (password
          at least 6 characters), plus an optional <b>department</b> column holding an existing
          department name. Everyone is created as a member. Emails that already exist are
          skipped, and up to 200 rows can be imported at a time.
        </p>

        <a
          href='/sample-members.csv'
          download
          className='inline-flex items-center gap-2 text-sm text-primary underline'
        >
          <LuDownload className='text-base' />
          Download sample CSV
        </a>

        <input
          type='file'
          accept='.csv,text/csv'
          onChange={(e) => { setCsvFile(e.target.files?.[0] || null); setResult(null); }}
          className='block w-full text-sm border border-gray-200 rounded-lg p-2 cursor-pointer'
        />

        {result && (
          <div className='text-sm'>
            <p>
              Created <b>{result.created || 0}</b> &middot; Skipped (already exist){' '}
              <b>{result.skipped || 0}</b> &middot; Failed <b>{result.failed ?? result.errors?.length ?? 0}</b>
            </p>
            {result.errors?.length > 0 && (
              <ul className='mt-2 max-h-40 overflow-y-auto list-disc pl-5 text-red-500'>
                {result.errors.map((err, i) => (
                  <li key={i}>{err.line ? `Line ${err.line}: ` : ''}{err.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className='flex justify-end gap-2'>
          <button className='card-btn' onClick={closeImport}>Close</button>
          <button className='add-btn' onClick={handleImport} disabled={importing}>
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      </Modal>
    </DashboardLayout>
  )
}

export default ManageUsers

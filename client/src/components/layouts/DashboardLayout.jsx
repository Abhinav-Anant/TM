import React, { useContext } from 'react';
import { UserContext } from '../../context/userContext';
import Navbar from './Navbar';
import SideMenu from './SideMenu';

const DashboardLayout = ({ children, activeMenu }) => {
  const { user } = useContext(UserContext);

  return (
    <div className="min-h-screen">
      <Navbar activeMenu={activeMenu} />

      {user && (
        <div className="flex">
          <div className="max-[1080px]:hidden">
            <SideMenu activeMenu={activeMenu} />
          </div>

          {/* The stage: one perspective origin, so every panel inside tilts
              against the same camera instead of each inventing its own. */}
          <main className="stage grow min-w-0 px-5 md:px-8 pb-16">{children}</main>
        </div>
      )}
    </div>
  );
};

export default DashboardLayout;

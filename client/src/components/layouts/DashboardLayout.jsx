import React, { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { LuSmartphone, LuX } from 'react-icons/lu';
import { UserContext } from '../../context/userContext';
import Navbar from './Navbar';
import SideMenu from './SideMenu';

/**
 * Nags anyone who has not saved a WhatsApp number yet. Deliberately not a hard
 * gate: someone who will not share a personal number can still do their job on
 * in-app alerts, and locking them out of the portal would not get us a number.
 * Dismissal lasts the session, so it returns on the next sign-in.
 */
const PhonePrompt = () => {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('phonePromptDismissed') === '1'
  );

  if (dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem('phonePromptDismissed', '1');
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 mt-4 mx-5 text-[13px]">
      <LuSmartphone className="text-lg shrink-0" />
      <p className="grow">
        Add your WhatsApp number to get task alerts on your phone.{' '}
        <Link to="/profile" className="font-medium underline underline-offset-2">
          Add it now
        </Link>
      </p>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="cursor-pointer">
        <LuX className="text-base" />
      </button>
    </div>
  );
};

const DashboardLayout = ({ children, activeMenu }) => {
  const { user } = useContext(UserContext);

  return (
    <div>
      <Navbar activeMenu={activeMenu} />
      {user && (
        <>
          {!user.phone && <PhonePrompt />}
          <div className="flex">
            <div className="max-[1080px]:hidden">
              <SideMenu activeMenu={activeMenu} />
            </div>
            <div className="grow mx-5">{children}</div>
          </div>
        </>
      )}
    </div>
  );
};

export default DashboardLayout;

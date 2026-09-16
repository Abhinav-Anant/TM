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
    <div className="panel flex items-center gap-3 px-4 py-3 mt-6 mx-5 md:mx-8 text-[13px] border-signal/25 bg-signal/6">
      <LuSmartphone className="text-lg text-signal shrink-0" />
      <p className="grow text-mist">
        Add your WhatsApp number to get task alerts on your phone.{' '}
        <Link
          to="/profile"
          className="text-signal hover:underline underline-offset-4"
          viewTransition
        >
          Add it now
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-dusk hover:text-beam transition-colors cursor-pointer shrink-0"
      >
        <LuX className="text-base" />
      </button>
    </div>
  );
};

const DashboardLayout = ({ children, activeMenu }) => {
  const { user } = useContext(UserContext);

  return (
    <div className="min-h-screen">
      <Navbar activeMenu={activeMenu} />

      {user && (
        <>
          {!user.phone && <PhonePrompt />}

          <div className="flex">
            <div className="max-[1080px]:hidden">
              <SideMenu activeMenu={activeMenu} />
            </div>

            {/* The stage: one perspective origin, so every panel inside tilts
                against the same camera instead of each inventing its own. */}
            <main className="stage grow min-w-0 px-5 md:px-8 pb-16">{children}</main>
          </div>
        </>
      )}
    </div>
  );
};

export default DashboardLayout;

import React from 'react';
import { LuUser } from 'react-icons/lu';

const AvatarGroup = ({ avatars = [], maxVisible = 3 }) => {
    const overflow = avatars.length - maxVisible;

    return (
        <div className="flex items-center">
            {avatars.slice(0, maxVisible).map((avatar, index) =>
                // Most people never upload a photo; an <img src={null}> renders as a broken ring.
                avatar ? (
                    <img
                        src={avatar}
                        alt=""
                        key={`${avatar}_${index}`}
                        className="w-8 h-8 rounded-full object-cover bg-deck border-2 border-hull -ml-2.5 first:ml-0"
                    />
                ) : (
                    <div
                        key={`none_${index}`}
                        className="w-8 h-8 grid place-items-center rounded-full bg-deck text-ice border-2 border-hull -ml-2.5 first:ml-0"
                    >
                        <LuUser className="text-sm" />
                    </div>
                )
            )}

            {overflow > 0 && (
                <div className="w-8 h-8 grid place-items-center bg-deck text-ice text-[11px] font-medium rounded-full border-2 border-hull -ml-2.5 num">
                    +{overflow}
                </div>
            )}
        </div>
    );
};

export default AvatarGroup;

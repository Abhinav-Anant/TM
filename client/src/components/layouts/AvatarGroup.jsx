import React from 'react';

const AvatarGroup = ({ avatars = [], maxVisible = 3 }) => {
    const overflow = avatars.length - maxVisible;

    return (
        <div className="flex items-center">
            {avatars.slice(0, maxVisible).map((avatar, index) => (
                <img
                    src={avatar}
                    alt=""
                    key={`${avatar}_${index}`}
                    className="w-8 h-8 rounded-full object-cover bg-deck border-2 border-hull -ml-2.5 first:ml-0"
                />
            ))}

            {overflow > 0 && (
                <div className="w-8 h-8 grid place-items-center bg-deck text-ice text-[11px] font-medium rounded-full border-2 border-hull -ml-2.5 num">
                    +{overflow}
                </div>
            )}
        </div>
    );
};

export default AvatarGroup;

import React, { useEffect, useRef, useState } from 'react';
import { LuUser, LuUpload, LuTrash } from 'react-icons/lu';

const ProfilePhotoSelector = ({ image, setImage }) => {
    const inputRef = useRef(null);
    const [previewUrl, setPreviewUrl] = useState(null);

    // Object URLs are a leak if nobody revokes them.
    useEffect(() => {
        if (!image) {
            setPreviewUrl(null);
            return undefined;
        }
        const url = URL.createObjectURL(image);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [image]);

    return (
        <div className="flex justify-center mb-7">
            <input
                type="file"
                accept="image/*"
                ref={inputRef}
                onChange={(e) => setImage(e.target.files?.[0] || null)}
                className="hidden"
            />

            <div className="relative">
                {previewUrl ? (
                    <img
                        src={previewUrl}
                        alt="Your profile photo"
                        className="w-20 h-20 rounded-full object-cover border border-white/15"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="w-20 h-20 grid place-items-center rounded-full panel-sunken text-ice cursor-pointer hover:text-signal transition-colors"
                        aria-label="Add a profile photo"
                    >
                        <LuUser className="text-3xl" />
                    </button>
                )}

                <button
                    type="button"
                    onClick={() => (previewUrl ? setImage(null) : inputRef.current?.click())}
                    aria-label={previewUrl ? 'Remove photo' : 'Choose a photo'}
                    className={`absolute -bottom-1 -right-1 w-8 h-8 grid place-items-center rounded-full cursor-pointer transition-colors ${
                        previewUrl
                            ? 'bg-alert/20 text-alert border border-alert/40 hover:bg-alert/30'
                            : 'bg-signal text-void hover:brightness-110'
                    }`}
                >
                    {previewUrl ? <LuTrash /> : <LuUpload />}
                </button>
            </div>
        </div>
    );
};

export default ProfilePhotoSelector;

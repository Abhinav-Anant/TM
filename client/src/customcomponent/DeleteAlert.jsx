import React from 'react';
import { LuTriangleAlert } from 'react-icons/lu';

const DeleteAlert = ({ content, onDelete }) => (
    <div>
        <div className="flex items-start gap-3">
            <span className="grid place-items-center w-9 h-9 shrink-0 rounded-lg bg-alert/12 text-alert border border-alert/25">
                <LuTriangleAlert />
            </span>
            <p className="text-sm text-mist leading-relaxed pt-1.5">{content}</p>
        </div>

        <div className="flex justify-end mt-6">
            <button className="btn btn-danger" type="button" onClick={onDelete}>
                Delete
            </button>
        </div>
    </div>
);

export default DeleteAlert;

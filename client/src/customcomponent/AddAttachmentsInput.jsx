import React, { useRef, useState } from 'react';
import { HiMiniPlus, HiOutlineTrash } from 'react-icons/hi2';
import { LuPaperclip, LuUpload, LuExternalLink } from 'react-icons/lu';
import toast from 'react-hot-toast';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';

const MAX_FILES = 5;
const MAX_SIZE_MB = 15;

const fileNameOf = (url) => {
    try {
        const name = decodeURIComponent(url.split("/").pop() || url);
        // Uploaded files are prefixed with a timestamp - hide it.
        return name.replace(/^\d{10,}-/, "");
    } catch {
        return url;
    }
};

const AddAttachmentsInput = ({ attachments = [], setAttachments }) => {
    const [option, setOption] = useState("");
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);

    const handleAddOption = () => {
        if (option.trim()) {
            setAttachments([...attachments, option.trim()]);
            setOption("");
        }
    };

    const handleDeleteOption = (index) => {
        setAttachments(attachments.filter((_, idx) => idx !== index));
    };

    const handleFiles = async (event) => {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        const oversized = files.find((f) => f.size > MAX_SIZE_MB * 1024 * 1024);
        if (oversized) {
            toast.error(`${oversized.name} is larger than ${MAX_SIZE_MB}MB.`);
            event.target.value = "";
            return;
        }

        const formData = new FormData();
        files.slice(0, MAX_FILES).forEach((file) => formData.append("files", file));

        setUploading(true);
        try {
            const { data } = await axiosInstance.post(API_PATHS.TASKS.UPLOAD_ATTACHMENTS, formData, {
                headers: { "Content-Type": "multipart/form-data" },
                timeout: 120000, // the instance default (10s) is far too short for a 15MB upload
            });
            setAttachments([...attachments, ...(data.urls || [])]);
            toast.success(`${data.urls?.length || 0} file(s) attached`);
        } catch (error) {
            toast.error(error.response?.data?.message || "Upload failed");
        } finally {
            setUploading(false);
            event.target.value = ""; // let the same file be picked again
        }
    };

    return (
        <div>
            {attachments.map((item, index) => (
                <div
                    className='group flex justify-between items-center panel-sunken rounded-lg px-3 py-2.5 mb-2'
                    key={`${item}_${index}`}
                >
                    <div className='flex-1 flex items-center gap-3 min-w-0'>
                        <LuPaperclip className='text-dusk shrink-0' />
                        <a
                            href={item}
                            target="_blank"
                            rel="noopener noreferrer"
                            className='text-sm text-beam truncate hover:text-signal hover:underline'
                            title={item}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {fileNameOf(item)}
                        </a>
                        <LuExternalLink className='text-dusk text-xs shrink-0' />
                    </div>

                    <button
                        type='button'
                        className='text-dusk hover:text-alert ml-3 cursor-pointer transition-colors'
                        aria-label='Remove attachment'
                        onClick={() => handleDeleteOption(index)}
                    >
                        <HiOutlineTrash className='text-alert' />
                    </button>
                </div>
            ))}

            <div className='flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-4'>
                <div className='field flex-1 flex items-center gap-3 py-0'>
                    <LuPaperclip className='text-dusk shrink-0' />
                    <input
                        type="text"
                        placeholder='Paste a file link'
                        value={option}
                        onChange={({ target }) => setOption(target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddOption(); } }}
                        className='w-full text-sm text-beam placeholder:text-dusk outline-none bg-transparent py-2.5'
                    />
                </div>

                <button type='button' className='btn text-nowrap justify-center' onClick={handleAddOption}>
                    <HiMiniPlus className='text-lg' /> Add Link
                </button>

                <button
                    type='button'
                    className='btn text-nowrap justify-center'
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <LuUpload className='text-base' /> {uploading ? "Uploading..." : "Upload File"}
                </button>

                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    accept="image/*,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    onChange={handleFiles}
                />
            </div>

            <p className='text-[11px] text-dusk mt-2'>
                Up to {MAX_FILES} files, {MAX_SIZE_MB}MB each. Images, PDF, Office docs, text, CSV and ZIP.
            </p>
        </div>
    );
};

export default AddAttachmentsInput;

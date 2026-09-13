import React, { useContext, useState } from 'react';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuSend, LuTrash2, LuMessageSquare } from 'react-icons/lu';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { UserContext } from '../context/userContext';

const initials = (name = "?") => name.trim().charAt(0).toUpperCase();

const TaskComments = ({ taskId, comments = [], onChange }) => {
    const { user } = useContext(UserContext);
    const [text, setText] = useState("");
    const [posting, setPosting] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (!trimmed || posting) return;

        setPosting(true);
        try {
            const { data } = await axiosInstance.post(API_PATHS.TASKS.ADD_COMMENT(taskId), { text: trimmed });
            onChange(data.comments || []);
            setText("");
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to post comment");
        } finally {
            setPosting(false);
        }
    };

    const remove = async (commentId) => {
        try {
            const { data } = await axiosInstance.delete(API_PATHS.TASKS.DELETE_COMMENT(taskId, commentId));
            onChange(data.comments || []);
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to delete comment");
        }
    };

    const canDelete = (comment) =>
        user?.role === "admin" || comment.user?._id === user?._id;

    return (
        <div className="mt-6 pt-5 border-t border-gray-100">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <LuMessageSquare /> Comments ({comments.length})
            </label>

            <div className="mt-3 space-y-3">
                {comments.length === 0 && (
                    <p className="text-[13px] text-gray-400">No comments yet. Start the conversation.</p>
                )}

                {comments.map((comment) => (
                    <div key={comment._id} className="flex gap-3 group">
                        {comment.user?.profileImageUrl ? (
                            <img
                                src={comment.user.profileImageUrl}
                                alt=""
                                className="w-8 h-8 rounded-full object-cover shrink-0 bg-slate-200"
                            />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-xs font-semibold flex items-center justify-center shrink-0">
                                {initials(comment.user?.name)}
                            </div>
                        )}

                        <div className="flex-1 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[13px] font-medium text-gray-800">
                                    {comment.user?.name || "Unknown"}
                                    <span className="ml-2 text-[11px] font-normal text-gray-400">
                                        {moment(comment.createdAt).fromNow()}
                                    </span>
                                </p>
                                {canDelete(comment) && (
                                    <button
                                        className="text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 cursor-pointer"
                                        aria-label="Delete comment"
                                        onClick={() => remove(comment._id)}
                                    >
                                        <LuTrash2 className="text-sm" />
                                    </button>
                                )}
                            </div>
                            <p className="text-[13px] text-gray-700 mt-1 whitespace-pre-wrap break-words">
                                {comment.text}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            <form className="flex items-end gap-2 mt-4" onSubmit={submit}>
                <textarea
                    rows={2}
                    value={text}
                    maxLength={2000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Write a comment..."
                    aria-label="Write a comment"
                    className="flex-1 text-sm text-black outline-none bg-white border border-slate-200 rounded-md px-3 py-2 resize-y focus:ring-2 focus:ring-blue-200"
                />
                <button
                    type="submit"
                    disabled={posting || !text.trim()}
                    className="flex items-center gap-2 text-sm text-white bg-blue-600 px-4 py-2.5 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                    <LuSend /> {posting ? "Posting" : "Post"}
                </button>
            </form>
        </div>
    );
};

export default TaskComments;

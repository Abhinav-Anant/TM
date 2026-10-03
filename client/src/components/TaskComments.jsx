import React, { useContext, useState } from 'react';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuSend, LuTrash2, LuMessageSquare } from 'react-icons/lu';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { UserContext } from '../context/userContext';

const initials = (name = "?") => name.trim().charAt(0).toUpperCase();

const TaskComments = ({ taskId, comments = [], people = [], onChange }) => {
    const { user } = useContext(UserContext);
    const [text, setText] = useState("");
    const [posting, setPosting] = useState(false);

    // "@Xe" at the end of the box offers the people on the task whose names start that way.
    const partial = /(?:^|\s)@([\w-]*)$/.exec(text);
    const suggestions = partial
        ? people.filter((p) => p._id !== user?._id && p.name.toLowerCase().startsWith(partial[1].toLowerCase())).slice(0, 5)
        : [];
    const pick = (person) => setText(text.replace(/@([\w-]*)$/, `@${person.name} `));

    const submit = async (e) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (!trimmed || posting) return;

        setPosting(true);
        try {
            // Only names actually written in the comment count as mentions.
            const mentions = people.filter((p) => trimmed.includes(`@${p.name}`)).map((p) => p._id);
            const { data } = await axiosInstance.post(API_PATHS.TASKS.ADD_COMMENT(taskId), { text: trimmed, mentions });
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
        <div className="mt-8 pt-6 border-t border-white/8">
            <label className="flex items-center gap-2 text-xs font-medium text-mist">
                <LuMessageSquare /> Comments ({comments.length})
            </label>

            <div className="mt-3 space-y-3">
                {comments.length === 0 && (
                    <p className="text-sm text-dusk">No comments yet. Start the conversation.</p>
                )}

                {comments.map((comment) => (
                    <div key={comment._id} className="flex gap-3 group">
                        {comment.user?.profileImageUrl ? (
                            <img
                                src={comment.user.profileImageUrl}
                                alt=""
                                className="w-8 h-8 rounded-full object-cover shrink-0 bg-deck border border-white/10"
                            />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-deck border border-white/10 text-ice text-xs font-semibold grid place-items-center shrink-0">
                                {initials(comment.user?.name)}
                            </div>
                        )}

                        <div className="flex-1 panel-sunken rounded-lg px-3.5 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[13px] font-medium text-beam">
                                    {comment.user?.name || "Unknown"}
                                    <span className="ml-2 text-[11px] font-normal text-dusk">
                                        {moment(comment.createdAt).fromNow()}
                                    </span>
                                </p>
                                {canDelete(comment) && (
                                    <button
                                        className="text-dusk hover:text-alert opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
                                        aria-label="Delete comment"
                                        onClick={() => remove(comment._id)}
                                    >
                                        <LuTrash2 className="text-sm" />
                                    </button>
                                )}
                            </div>
                            <p className="text-[13px] text-mist mt-1 whitespace-pre-wrap break-words leading-relaxed">
                                {comment.text}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            <form className="flex items-end gap-2 mt-4 relative" onSubmit={submit}>
                {suggestions.length > 0 && (
                    <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 mb-1 bg-deck border border-white/12 shadow-xl rounded-lg py-1 min-w-48 z-10">
                        {suggestions.map((p) => (
                            <li key={p._id}>
                                <button type="button" role="option" className="w-full text-left text-sm text-beam px-3 py-1.5 hover:bg-white/8 cursor-pointer" onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                                    @{p.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <textarea
                    rows={2}
                    value={text}
                    maxLength={2000}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Write a comment... type @ to mention someone"
                    aria-label="Write a comment"
                    className="field flex-1 resize-y"
                />
                <button
                    type="submit"
                    disabled={posting || !text.trim()}
                    className="btn btn-primary shrink-0"
                >
                    <LuSend /> {posting ? "Posting" : "Post"}
                </button>
            </form>
        </div>
    );
};

export default TaskComments;

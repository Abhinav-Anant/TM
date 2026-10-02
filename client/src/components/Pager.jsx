import React from 'react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';

/** Previous / next with a "page x of y" label. Renders nothing when everything fits on one page. */
const Pager = ({ page, pages, total, onChange, noun = 'tasks' }) => {
    if (pages <= 1) return null;
    return (
        <nav className="flex items-center justify-between gap-3 mt-6" aria-label="Pagination">
            <span className="text-xs text-dusk num">{total} {noun}</span>
            <div className="flex items-center gap-2">
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
                    <LuChevronLeft /> Previous
                </button>
                <span className="text-sm text-mist num" aria-current="page">Page {page} of {pages}</span>
                <button className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
                    Next <LuChevronRight />
                </button>
            </div>
        </nav>
    );
};

export default Pager;

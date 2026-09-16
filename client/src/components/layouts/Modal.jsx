import React, { useEffect, useRef } from 'react';
import { LuX } from 'react-icons/lu';

/**
 * Native <dialog> rather than a div: the focus trap, Escape handling, inert
 * background and top-layer stacking all come with it.
 */
const Modal = ({ children, isOpen, onClose, title }) => {
    const ref = useRef(null);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;

        if (isOpen && !dialog.open) dialog.showModal();
        if (!isOpen && dialog.open) dialog.close();
    }, [isOpen]);

    // Escape, the backdrop and the close button all route through the same
    // handler, so the parent's state can never drift out of sync.
    const handleCancel = (e) => {
        e.preventDefault();
        onClose?.();
    };

    return (
        <dialog
            ref={ref}
            className="modal"
            onCancel={handleCancel}
            onClick={(e) => { if (e.target === ref.current) onClose?.(); }}
        >
            <div className="modal-panel panel panel-raised panel-blur text-beam" role="document">
                <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/8">
                    <h3 className="font-display text-base text-beam">{title}</h3>
                    <button
                        type="button"
                        className="grid place-items-center w-8 h-8 rounded-lg text-mist hover:text-beam hover:bg-white/8 transition-colors cursor-pointer"
                        aria-label="Close"
                        onClick={onClose}
                    >
                        <LuX />
                    </button>
                </div>

                <div className="p-5">{children}</div>
            </div>
        </dialog>
    );
};

export default Modal;

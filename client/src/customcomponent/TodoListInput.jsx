import React, { useState } from 'react';
import { LuPlus, LuTrash2, LuSquare } from 'react-icons/lu';

const TodoListInput = ({ todoList = [], setTodoList }) => {
    const [option, setOption] = useState('');

    const handleAddOption = () => {
        const trimmed = option.trim();
        if (!trimmed) return;
        setTodoList([...todoList, trimmed]);
        setOption('');
    };

    const handleDeleteOption = (index) => {
        setTodoList(todoList.filter((_, idx) => idx !== index));
    };

    return (
        <div className="mt-2">
            <ul className="space-y-2">
                {todoList.map((item, index) => (
                    <li
                        key={`${item}_${index}`}
                        className="group flex items-center gap-3 panel-sunken rounded-lg px-3 py-2.5"
                    >
                        {/* An empty box, because that is what this becomes once the
                            task is saved and someone starts ticking it off. */}
                        <LuSquare className="text-dusk shrink-0" />
                        <p className="text-sm text-beam flex-1 break-words">{item}</p>
                        <button
                            type="button"
                            aria-label={`Remove ${item}`}
                            className="text-dusk hover:text-alert opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
                            onClick={() => handleDeleteOption(index)}
                        >
                            <LuTrash2 />
                        </button>
                    </li>
                ))}
            </ul>

            <div className="flex items-center gap-3 mt-3">
                <input
                    type="text"
                    className="field"
                    placeholder="Add a step"
                    value={option}
                    onChange={({ target }) => setOption(target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleAddOption(); }
                    }}
                />
                <button type="button" className="btn shrink-0" onClick={handleAddOption}>
                    <LuPlus /> Add
                </button>
            </div>
        </div>
    );
};

export default TodoListInput;

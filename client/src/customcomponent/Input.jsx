import React, { useId, useState } from 'react';
import { LuEye, LuEyeOff } from 'react-icons/lu';

const Input = ({ label, type, value, onChange, placeholder, error }) => {
  const [showPassword, setShowPassword] = useState(false);
  const id = useId();
  const isPassword = type === 'password';

  return (
    <div className="mb-5">
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          type={isPassword ? (showPassword ? 'text' : 'password') : type}
          placeholder={placeholder}
          className={`field ${isPassword ? 'pr-11' : ''}`}
          value={value}
          onChange={onChange}
          aria-invalid={error ? true : undefined}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-mist hover:text-beam transition-colors cursor-pointer"
          >
            {showPassword ? <LuEye size={18} /> : <LuEyeOff size={18} />}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-alert mt-1.5">{error}</p>}
    </div>
  );
};

export default Input;

export const addThousandsSeparator = (num) => {
    if (num == null || isNaN(num)) return "0";  // Return "0" for invalid inputs

    // Convert the number to a string and split it into integer and fractional parts
    const [integerPart, fractionalPart] = num.toString().split(".");

    // Format the integer part with commas
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    // Combine the integer part with the fractional part if it exists
    return fractionalPart ? `${formattedInteger}.${fractionalPart}` : formattedInteger;
};

/** 205 -> "3h 25m", 60 -> "1h", 0 -> "0m". */
export const formatMinutes = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(m / 60);
    if (!h) return `${m}m`;
    return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
};

/**
 * Typed durations -> whole minutes: "4h", "1.5h", "3h 25m", "90m", "90". Blank is null; junk is NaN.
 */
export const parseDuration = (text) => {
    const raw = String(text ?? '').trim().toLowerCase();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw);
    const match = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(raw);
    if (!match || (match[1] === undefined && match[2] === undefined)) return NaN;
    return Math.round(Number(match[1] || 0) * 60 + Number(match[2] || 0));
};

export const REMINDER_DATA = [
    { label: 'No reminder', value: 'none' },
    { label: 'At due time', value: 'at_due' },
    { label: '1 hour before', value: '1h' },
    { label: '1 day before', value: '1d' },
    { label: 'Custom', value: 'custom' },
];

export const reminderLabel = (reminder) => {
    if (!reminder || reminder.type === 'none') return 'None';
    if (reminder.type === 'custom') return `${formatMinutes(reminder.customMinutes)} before`;
    return REMINDER_DATA.find((r) => r.value === reminder.type)?.label || 'None';
};

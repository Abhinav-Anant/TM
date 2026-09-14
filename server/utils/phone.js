// Blastup wants a bare international number - digits only, country code first,
// no "+" and no separators: 919876543210.
const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || "91";

/**
 * Normalises whatever a member typed into that form, or returns null if it
 * cannot be a real number. Storing the normalised value means the send path
 * never has to guess - a number either passed validation on the way in or was
 * never saved.
 *
 * ponytail: length heuristics, not a full libphonenumber. An unprefixed number
 * longer than 10 digits is assumed to already carry its country code, which is
 * right for a +91 deployment and wrong for national formats longer than that.
 * Swap in libphonenumber-js if this ever serves countries where that bites.
 */
const normalizePhone = (input) => {
    if (input === null || input === undefined) return null;

    const raw = String(input).trim();
    if (!raw) return null;

    // "+91..." and "0091..." both mean the country code is already present.
    const hasCountryCode = raw.startsWith("+") || raw.startsWith("00");

    let digits = raw.replace(/\D/g, "");
    if (raw.startsWith("00")) digits = digits.slice(2);
    // A leading 0 on a domestic number is a trunk prefix, not part of the number.
    if (!hasCountryCode) digits = digits.replace(/^0+/, "");
    if (!digits) return null;

    const full = hasCountryCode || digits.length > 10
        ? digits
        : DEFAULT_COUNTRY_CODE + digits;

    // E.164 allows at most 15 digits and no country code starts with 0.
    return /^[1-9]\d{7,14}$/.test(full) ? full : null;
};

module.exports = { normalizePhone, DEFAULT_COUNTRY_CODE };

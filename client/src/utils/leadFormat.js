/**
 * Display helpers shared by the three sales pages.
 *
 * The API always returns plain rupees; formatting to lakhs happens here and
 * nowhere else, so a number never gets converted twice.
 */

export const STAGES = ['New', 'Contacted', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Won', 'Lost'];
export const CLOSED_STAGES = ['Won', 'Lost'];

export const PRODUCTS = ['Internet', 'Firewall', 'LeoPrime', 'SD-WAN', 'Hotspot', 'VPS', 'CCTV', 'Cloud', 'Other'];

export const SOURCES = [
  'Website', 'WhatsApp', 'Inbound Call', 'Existing Customer', 'Referral',
  'Google', 'Facebook', 'Partner', 'Salesperson', 'Other',
];

export const OUTCOMES = ['Interested', 'Follow-up required', 'Proposal requested', 'Not interested', 'Wrong number'];

const LAKH = 100000;

/** ₹1.5L above a lakh, ₹45,000 below it - the way the numbers are actually spoken. */
export const formatRupees = (n) => {
  const value = Number(n) || 0;
  if (Math.abs(value) >= LAKH) return `${(value / LAKH).toFixed(1)}L`;
  return value.toLocaleString('en-IN');
};

/**
 * Stages reuse the existing chip tones rather than introducing a second colour
 * vocabulary - see statusChip/priorityChip in data.js. There are eight stages
 * and seven tones, so Qualified and Demo share one; they are adjacent mid-funnel
 * steps and the label is always rendered beside the colour.
 */
export const stageChip = (stage) => ({
  New: 'chip-mist',
  Contacted: 'chip-ice',
  Qualified: 'chip-active',
  Demo: 'chip-active',
  Proposal: 'chip-signal',
  Negotiation: 'chip-pending',
  Won: 'chip-done',
  Lost: 'chip-alert',
}[stage] || 'chip-mist');

'use strict';
function addressKey(value) {
  const s = String(value || '').trim();
  return /^0x[0-9a-f]+$/i.test(s) ? s.toLowerCase() : s;
}
function toUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Invalid token decimals');
  const s = String(value);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Amount must be a positive decimal string');
  const [whole, fraction = ''] = s.split('.');
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) throw new Error('Amount exceeds token precision');
  const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0');
  if (result <= 0n) throw new Error('Amount must be positive');
  return result.toString();
}
function fromUnits(value, decimals) {
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Invalid base-unit amount');
  const s = String(value).padStart(decimals + 1, '0');
  return decimals ? s.slice(0, -decimals) + '.' + s.slice(-decimals) : s;
}
module.exports = { addressKey, toUnits, fromUnits };

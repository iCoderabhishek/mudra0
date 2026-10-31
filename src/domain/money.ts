// All money is integer paise held in bigint. No floating point anywhere.
export const RUPEE = 100n;

export const rupees = (amount: number) => BigInt(amount) * RUPEE;

// Integer division rounded half-up. Inputs are non-negative.
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);

export function formatRupees(paise: bigint): string {
  const sign = paise < 0n ? "-" : "";
  const abs = paise < 0n ? -paise : paise;
  const whole = (abs / RUPEE).toString();
  const fraction = (abs % RUPEE).toString().padStart(2, "0");
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}₹${rest ? `${rest},${lastThree}` : lastThree}.${fraction}`;
}

/**
 * Money is stored as integer minor units (e.g. paisa/cents), never floats or
 * numeric. These helpers exist so no part of the app is tempted to use a float.
 */
export type MinorUnits = number;

export function toMinorUnits(major: number, unitsPerMajor = 100): MinorUnits {
  return Math.round(major * unitsPerMajor);
}

export function formatMinorUnits(
  amount: MinorUnits,
  currency: string,
  locale = 'en-US',
  unitsPerMajor = 100,
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount / unitsPerMajor,
  );
}

export function sumMinorUnits(amounts: readonly MinorUnits[]): MinorUnits {
  return amounts.reduce((total, amount) => total + amount, 0);
}

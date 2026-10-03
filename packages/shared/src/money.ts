/**
 * Money is stored as integer minor units (e.g. paisa/cents), never floats or
 * numeric. These helpers exist so no part of the app is tempted to use a float.
 */
export type MinorUnits = number;

/**
 * The currency's ISO 4217 exponent: 2 for BDT and USD, 0 for JPY, 3 for KWD.
 * Read from Intl, which carries ISO's table, so no list here can go stale.
 */
export function currencyDecimals(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** How many minor units make one major unit: 100 paisa to the taka, 1 yen to the yen. */
export function minorUnitsPerMajor(currency: string): number {
  return 10 ** currencyDecimals(currency);
}

export function toMinorUnits(major: number, unitsPerMajor = 100): MinorUnits {
  return Math.round(major * unitsPerMajor);
}

/** For an editable amount field only; display goes through formatMinorUnits. */
export function fromMinorUnits(amount: MinorUnits, unitsPerMajor = 100): number {
  return amount / unitsPerMajor;
}

export function formatMinorUnits(
  amount: MinorUnits,
  currency: string,
  locale = 'en-US',
  unitsPerMajor = minorUnitsPerMajor(currency),
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount / unitsPerMajor,
  );
}

/**
 * The amount alone, for a column whose header carries the currency: the
 * currency's own decimals, dropped when they are zero ("1,600", "1,600.50").
 */
export function formatMinorUnitsAmount(
  amount: MinorUnits,
  currency: string,
  locale = 'en-US',
  unitsPerMajor = minorUnitsPerMajor(currency),
): string {
  const { minimumFractionDigits, maximumFractionDigits } = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).resolvedOptions();
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
    trailingZeroDisplay: 'stripIfInteger',
  }).format(amount / unitsPerMajor);
}

export function sumMinorUnits(amounts: readonly MinorUnits[]): MinorUnits {
  return amounts.reduce((total, amount) => total + amount, 0);
}

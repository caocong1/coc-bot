export const PRIMARY_ATTRIBUTE_KEYS = [
  'STR',
  'CON',
  'SIZ',
  'DEX',
  'APP',
  'INT',
  'POW',
  'EDU',
] as const;

export function calculatePrimaryAttributeTotal(attributes?: Record<string, number | null | undefined>): number {
  if (!attributes) return 0;
  return PRIMARY_ATTRIBUTE_KEYS.reduce((total, key) => {
    const value = attributes[key] ?? attributes[key.toLowerCase()] ?? 0;
    return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  }, 0);
}

export function normalizeOptionalTotalPoints(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : null;
}

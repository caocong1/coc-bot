function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function hasEraValues(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => toTrimmedString(entry).length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeArmorReferenceEntries<T>(rows: T[]): T[] {
  return rows.filter((row) => {
    if (!isRecord(row)) return false;
    const name = toTrimmedString(row.name);
    const armorValue = toTrimmedString(row.armorValue);
    return name.length > 0 && name !== '术语解释' && armorValue.length > 0;
  });
}

export function sanitizeVehicleReferenceEntries<T>(rows: T[]): T[] {
  return rows.filter((row) => {
    if (!isRecord(row)) return false;
    const name = toTrimmedString(row.name);
    const skill = toTrimmedString(row.skill);
    return name.length > 0 && name !== '术语解释' && skill.length > 0 && hasEraValues(row.era);
  });
}

export function sanitizePlayerReferenceData(key: string, data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  switch (key) {
    case 'armor':
      return sanitizeArmorReferenceEntries(data);
    case 'vehicles':
      return sanitizeVehicleReferenceEntries(data);
    default:
      return data;
  }
}

import type { ExternalReference, ReferenceQuery } from "./types.js";

/** Build the `external_reference` object for a write request. */
export function toApiReference(reference: ExternalReference): Record<string, string> {
  const body: Record<string, string> = { id: reference.id };

  if (reference.groupId !== null) body.group_id = reference.groupId;
  if (reference.accountId !== null) body.account_id = reference.accountId;
  if (reference.permalink !== null) body.permalink = reference.permalink;

  return body;
}

/** Read an `external_reference` off a time entry, tolerating its absence. */
export function fromApiReference(raw: unknown): ExternalReference | null {
  if (raw === null || typeof raw !== "object") return null;

  const source = raw as Record<string, unknown>;
  const id = source.id;

  // Harvest hands ids back as numbers as well as strings; comparing without
  // coercing silently fails to match.
  if (typeof id !== "string" && typeof id !== "number") return null;
  const normalizedId = String(id);
  if (normalizedId === "") return null;

  return {
    id: normalizedId,
    groupId: optionalString(source.group_id),
    accountId: optionalString(source.account_id),
    permalink: optionalString(source.permalink),
  };
}

/**
 * Whether an entry's reference is the one being asked about.
 *
 * A query with no group matches on id alone. A query with a group requires the
 * entry to carry that same group, which is what keeps issue #5515 in one
 * repository from being counted against #5515 in another.
 */
export function matchesReference(
  reference: ExternalReference | null,
  query: ReferenceQuery,
): boolean {
  if (reference === null) return false;
  if (reference.id !== query.externalId) return false;

  const group = query.groupId ?? null;
  if (group === null) return true;

  return reference.groupId === group;
}

/** Total hours across the entries matching one reference. */
export function sumHoursForReference(
  entries: { hours: number; externalReference: ExternalReference | null }[],
  query: ReferenceQuery,
): number {
  return entries
    .filter((entry) => matchesReference(entry.externalReference, query))
    .reduce((total, entry) => total + entry.hours, 0);
}

function optionalString(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return null;
}

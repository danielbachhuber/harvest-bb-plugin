/**
 * A link from a Harvest time entry to the thing it is about.
 *
 * The field names mirror the convention the Harvest Chrome extension uses for
 * GitHub, so a timer started in bb and one started in the browser on the same
 * issue carry the same reference and their hours are counted together:
 * `id` is the issue number, `groupId` the repository, `accountId` the owner.
 */
export interface ExternalReference {
  id: string;
  groupId: string | null;
  accountId: string | null;
  permalink: string | null;
}

/** Which entries to count toward one reference's total. */
export interface ReferenceQuery {
  externalId: string;
  /**
   * Harvest's `external_reference_id` filter matches on `id` alone, across
   * every service, so issue #5515 in one repository is indistinguishable from
   * #5515 in another. Supplying the group narrows that after the fetch.
   */
  groupId?: string | null;
}

export interface TimeEntry {
  id: number;
  projectName: string;
  taskName: string;
  notes: string | null;
  hours: number;
  timerStartedAt: string | null;
  externalReference: ExternalReference | null;
}

export interface TaskOption {
  id: number;
  name: string;
}

export interface ProjectOption {
  id: number;
  name: string;
  code: string | null;
  clientName: string | null;
  tasks: TaskOption[];
}

export interface Selection {
  projectId: number;
  taskId: number;
}

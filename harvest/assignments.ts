import type { ProjectOption, TaskOption } from "./types.js";

/**
 * Turn `GET /v2/users/me/project_assignments` into the picker's project list.
 *
 * The response is already scoped to what this user may track against, so the
 * work here is shape, ordering, and dropping what cannot be tracked: an
 * inactive assignment, an inactive task, or a project with no active task at
 * all. A malformed row is skipped rather than allowed to fail the whole list,
 * because one bad project should not cost the user every other one.
 *
 * `raw` is the concatenation of every page's `project_assignments`.
 */
export function normalizeAssignments(raw: unknown[]): ProjectOption[] {
  const projects: ProjectOption[] = [];

  for (const row of raw) {
    const project = normalizeOne(row);
    if (project !== null) projects.push(project);
  }

  return projects.sort(byClientThenName);
}

function normalizeOne(row: unknown): ProjectOption | null {
  if (row === null || typeof row !== "object") return null;

  const source = row as Record<string, unknown>;
  if (source.is_active === false) return null;

  const project = asRecord(source.project);
  if (project === null) return null;

  const id = asNumber(project.id);
  const name = asString(project.name);
  if (id === null || name === null) return null;

  const tasks = normalizeTasks(source.task_assignments);
  // A time entry requires a task, so a project offering none is unpickable.
  if (tasks.length === 0) return null;

  return {
    id,
    name,
    code: asString(project.code),
    clientName: asString(asRecord(source.client)?.name),
    tasks,
  };
}

function normalizeTasks(raw: unknown): TaskOption[] {
  if (!Array.isArray(raw)) return [];

  const tasks: TaskOption[] = [];

  for (const row of raw) {
    const source = asRecord(row);
    if (source === null || source.is_active === false) continue;

    const task = asRecord(source.task);
    const id = asNumber(task?.id);
    const name = asString(task?.name);
    if (id === null || name === null) continue;

    tasks.push({ id, name });
  }

  return tasks.sort((left, right) => left.name.localeCompare(right.name));
}

/** Clients group the list, and a project with no client sorts last. */
function byClientThenName(left: ProjectOption, right: ProjectOption): number {
  if (left.clientName !== right.clientName) {
    if (left.clientName === null) return 1;
    if (right.clientName === null) return -1;
    return left.clientName.localeCompare(right.clientName);
  }

  return left.name.localeCompare(right.name);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

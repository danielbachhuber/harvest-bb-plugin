/**
 * Selection rules for the timer picker.
 *
 * Kept separate from the component so the behavior that matters is testable
 * without driving a Radix popover in jsdom, and so the component stays a thin
 * rendering layer over decisions made here.
 */

export interface PickerTask {
  id: number;
  name: string;
}

export interface PickerProject {
  id: number;
  name: string;
  code: string | null;
  clientName: string | null;
  tasks: PickerTask[];
}

export interface PickerSelection {
  projectId: number;
  taskId: number;
}

/**
 * A selection read back from storage.
 *
 * `exact` distinguishes a scope's own history from a global fallback. A
 * surface that prefers a particular task (Reviews preferring Code Review)
 * should seed it over a fallback, but must never override a choice the user
 * made on that surface. Absent, it is treated as exact.
 */
export interface RememberedSelection extends PickerSelection {
  exact?: boolean;
}

/** The tasks available under one project. */
export function tasksFor(projects: PickerProject[], projectId: number | null): PickerTask[] {
  if (projectId === null) return [];
  return projects.find((project) => project.id === projectId)?.tasks ?? [];
}

/**
 * What the picker should open with.
 *
 * A remembered selection is honored only as far as it is still valid: a
 * project the user has since been unassigned from, or a task that no longer
 * exists on it, is repaired rather than offered, because Harvest rejects both
 * with an error that says nothing useful.
 */
export function resolveSelection(
  projects: PickerProject[],
  remembered: RememberedSelection | null,
  preferredTaskName?: string,
): PickerSelection | null {
  if (projects.length === 0) return null;

  const project =
    (remembered === null
      ? undefined
      : projects.find((candidate) => candidate.id === remembered.projectId)) ??
    projects.find((candidate) => candidate.tasks.length > 0);

  if (project === undefined) return null;

  const remembersThisProject = remembered !== null && remembered.projectId === project.id;
  const rememberedTask = remembersThisProject
    ? project.tasks.find((candidate) => candidate.id === remembered.taskId)
    : undefined;

  // A choice made on this surface wins. Anything else is a starting point, so
  // the surface's preferred task gets to seed it.
  if (rememberedTask !== undefined && remembered?.exact !== false) {
    return { projectId: project.id, taskId: rememberedTask.id };
  }

  const preferred =
    preferredTaskName === undefined
      ? undefined
      : project.tasks.find(
          (candidate) => candidate.name.toLowerCase() === preferredTaskName.toLowerCase(),
        );

  const taskId = preferred?.id ?? rememberedTask?.id ?? project.tasks[0]?.id;
  if (taskId === undefined) return null;

  return { projectId: project.id, taskId };
}

/**
 * The selection after choosing a project.
 *
 * The task always moves with it. Carrying the previous task over would post a
 * task that does not belong to the project.
 */
export function withProject(
  projects: PickerProject[],
  projectId: number,
): PickerSelection | null {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) return null;

  const taskId = project.tasks[0]?.id;
  if (taskId === undefined) return null;

  return { projectId: project.id, taskId };
}

function firstSelection(projects: PickerProject[]): PickerSelection | null {
  for (const project of projects) {
    const taskId = project.tasks[0]?.id;
    if (taskId !== undefined) return { projectId: project.id, taskId };
  }

  return null;
}

/**
 * Which remembered selection a list should open with.
 *
 * An unnamed list remembers per repository. A named one gets its own memory:
 * reviewing a pull request and working an issue are different kinds of work
 * even in one repository, and one shared memory means each overwrites the
 * other every time.
 */
export function memoryScope(surface: string | undefined, groupId: string | null): string | null {
  if (surface === undefined) return groupId;
  return `${surface}:${groupId ?? ""}`;
}

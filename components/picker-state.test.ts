import { describe, expect, test } from "vitest";

import { memoryScope, resolveSelection, tasksFor, withProject } from "./picker-state.js";

const projects = [
  {
    id: 11,
    name: "Internal",
    code: "INT",
    clientName: "New_ Public",
    tasks: [
      { id: 22, name: "Development" },
      { id: 23, name: "Review" },
    ],
  },
  {
    id: 12,
    name: "Website",
    code: null,
    clientName: "New_ Public",
    tasks: [{ id: 24, name: "Design" }],
  },
];

describe("tasksFor", () => {
  test("returns the tasks of the named project", () => {
    expect(tasksFor(projects, 11).map((task) => task.id)).toEqual([22, 23]);
  });

  test("returns nothing for an unknown project", () => {
    expect(tasksFor(projects, 999)).toEqual([]);
  });

  test("returns nothing when no project is chosen", () => {
    expect(tasksFor(projects, null)).toEqual([]);
  });
});

describe("resolveSelection with a preferred task", () => {
  const remembered = (projectId: number, taskId: number, exact: boolean) => ({
    projectId,
    taskId,
    exact,
  });

  test("seeds the preferred task when the scope has no memory of its own", () => {
    // The Reviews panel wants Code Review, but the global fallback carries
    // whatever was last picked anywhere, which would otherwise always win.
    expect(resolveSelection(projects, remembered(11, 22, false), "Review")).toEqual({
      projectId: 11,
      taskId: 23,
    });
  });

  test("keeps the project from the fallback while replacing the task", () => {
    // The remembered project is still the useful part: it is the client the
    // work belongs to.
    expect(resolveSelection(projects, remembered(12, 24, false), "Review")).toEqual({
      projectId: 12,
      taskId: 24,
    });
  });

  test("honours an exact memory over the preferred task", () => {
    // Once a surface has its own history, a deliberate choice has to stick.
    expect(resolveSelection(projects, remembered(11, 22, true), "Review")).toEqual({
      projectId: 11,
      taskId: 22,
    });
  });

  test("matches the preferred task without regard to case", () => {
    expect(resolveSelection(projects, remembered(11, 22, false), "review")).toEqual({
      projectId: 11,
      taskId: 23,
    });
  });

  test("falls back to the remembered task when the project has no such task", () => {
    // Project 12 offers only Design, so a Review preference cannot apply and
    // the fallback's own task stands.
    expect(resolveSelection(projects, remembered(12, 24, false), "Review")?.taskId).toBe(24);
  });

  test("uses the preferred task with nothing remembered at all", () => {
    expect(resolveSelection(projects, null, "Review")).toEqual({
      projectId: 11,
      taskId: 23,
    });
  });

  test("ignores a preferred task that matches nothing anywhere", () => {
    expect(resolveSelection(projects, null, "Nonexistent")).toEqual({
      projectId: 11,
      taskId: 22,
    });
  });
});

describe("resolveSelection", () => {
  test("uses the remembered selection when it is still valid", () => {
    expect(resolveSelection(projects, { projectId: 12, taskId: 24 })).toEqual({
      projectId: 12,
      taskId: 24,
    });
  });

  test("falls back to the first project and task when nothing is remembered", () => {
    expect(resolveSelection(projects, null)).toEqual({ projectId: 11, taskId: 22 });
  });

  test("drops a remembered project that is no longer assigned", () => {
    // Losing a project assignment should not leave the picker pointing at a
    // project Harvest will reject.
    expect(resolveSelection(projects, { projectId: 999, taskId: 22 })).toEqual({
      projectId: 11,
      taskId: 22,
    });
  });

  test("keeps a remembered project but repairs a task that no longer exists", () => {
    expect(resolveSelection(projects, { projectId: 12, taskId: 22 })).toEqual({
      projectId: 12,
      taskId: 24,
    });
  });

  test("returns nothing when there are no projects at all", () => {
    expect(resolveSelection([], { projectId: 11, taskId: 22 })).toBeNull();
  });
});

describe("withProject", () => {
  test("moves to the first task of the newly chosen project", () => {
    // Carrying the old task over would post a task that does not belong to
    // the project, which Harvest rejects with an opaque error.
    expect(withProject(projects, 12)).toEqual({ projectId: 12, taskId: 24 });
  });

  test("returns nothing for a project that is not assigned", () => {
    expect(withProject(projects, 999)).toBeNull();
  });
});

describe("memoryScope", () => {
  test("remembers per repository when the list is unnamed", () => {
    expect(memoryScope(undefined, "acme-widgets")).toBe("acme-widgets");
  });

  test("gives a named list its own memory", () => {
    expect(memoryScope("reviews", "acme-widgets")).toBe("reviews:acme-widgets");
  });

  test("keeps two named lists on one repository apart", () => {
    expect(memoryScope("reviews", "acme-widgets")).not.toBe(
      memoryScope("issues", "acme-widgets"),
    );
  });

  test("still scopes a named list with no repository", () => {
    expect(memoryScope("reviews", null)).toBe("reviews:");
  });

  test("has nothing to scope to when unnamed and repository-less", () => {
    expect(memoryScope(undefined, null)).toBeNull();
  });
});

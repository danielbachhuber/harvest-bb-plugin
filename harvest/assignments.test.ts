import { describe, expect, test } from "vitest";

import { normalizeAssignments } from "./assignments.js";

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    is_active: true,
    project: { id: 11, name: "Internal", code: "INT" },
    client: { id: 5, name: "New_ Public" },
    task_assignments: [{ is_active: true, task: { id: 22, name: "Development" } }],
    ...overrides,
  };
}

describe("normalizeAssignments", () => {
  test("maps a project assignment onto the picker shape", () => {
    expect(normalizeAssignments([assignment()])).toEqual([
      {
        id: 11,
        name: "Internal",
        code: "INT",
        clientName: "New_ Public",
        tasks: [{ id: 22, name: "Development" }],
      },
    ]);
  });

  test("drops an inactive project assignment", () => {
    expect(normalizeAssignments([assignment({ is_active: false })])).toEqual([]);
  });

  test("drops inactive tasks but keeps the project", () => {
    const raw = assignment({
      task_assignments: [
        { is_active: false, task: { id: 22, name: "Development" } },
        { is_active: true, task: { id: 23, name: "Review" } },
      ],
    });
    expect(normalizeAssignments([raw])[0]?.tasks).toEqual([{ id: 23, name: "Review" }]);
  });

  test("drops a project with no active tasks, since a timer needs one", () => {
    const raw = assignment({
      task_assignments: [{ is_active: false, task: { id: 22, name: "Development" } }],
    });
    expect(normalizeAssignments([raw])).toEqual([]);
  });

  test("reads an empty project code as absent", () => {
    const raw = assignment({ project: { id: 11, name: "Internal", code: "" } });
    expect(normalizeAssignments([raw])[0]?.code).toBeNull();
  });

  test("reads a missing client as absent", () => {
    const raw = assignment({ client: null });
    expect(normalizeAssignments([raw])[0]?.clientName).toBeNull();
  });

  test("orders projects by client, then by project name", () => {
    const rows = [
      assignment({ project: { id: 3, name: "Zebra", code: null }, client: { id: 1, name: "Acme" } }),
      assignment({ project: { id: 1, name: "Alpha", code: null }, client: { id: 2, name: "Beta" } }),
      assignment({ project: { id: 2, name: "Apple", code: null }, client: { id: 1, name: "Acme" } }),
    ];
    expect(normalizeAssignments(rows).map((project) => project.id)).toEqual([2, 3, 1]);
  });

  test("orders projects without a client after those with one", () => {
    const rows = [
      assignment({ project: { id: 1, name: "Alpha", code: null }, client: null }),
      assignment({ project: { id: 2, name: "Beta", code: null }, client: { id: 1, name: "Acme" } }),
    ];
    expect(normalizeAssignments(rows).map((project) => project.id)).toEqual([2, 1]);
  });

  test("orders tasks by name", () => {
    const raw = assignment({
      task_assignments: [
        { is_active: true, task: { id: 22, name: "Review" } },
        { is_active: true, task: { id: 23, name: "Development" } },
      ],
    });
    expect(normalizeAssignments([raw])[0]?.tasks.map((task) => task.name)).toEqual([
      "Development",
      "Review",
    ]);
  });

  test("skips a malformed assignment rather than failing the whole list", () => {
    // One bad row from the API should not cost the user every project.
    const rows = [{ is_active: true, project: null, task_assignments: [] }, assignment()];
    expect(normalizeAssignments(rows).map((project) => project.id)).toEqual([11]);
  });

  test("reads an empty response as an empty list", () => {
    expect(normalizeAssignments([])).toEqual([]);
  });
});

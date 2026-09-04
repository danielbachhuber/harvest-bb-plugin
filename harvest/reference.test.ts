import { describe, expect, test } from "vitest";

import {
  fromApiReference,
  matchesReference,
  sumHoursForReference,
  toApiReference,
} from "./reference.js";

const issue = {
  id: "5515",
  groupId: "psi-product",
  accountId: "danielbachhuber",
  permalink: "https://github.com/danielbachhuber/psi-product/issues/5515",
};

describe("toApiReference", () => {
  test("maps camelCase fields onto the snake_case body Harvest expects", () => {
    expect(toApiReference(issue)).toEqual({
      id: "5515",
      group_id: "psi-product",
      account_id: "danielbachhuber",
      permalink: "https://github.com/danielbachhuber/psi-product/issues/5515",
    });
  });

  test("omits absent fields rather than sending explicit nulls", () => {
    expect(toApiReference({ id: "7", groupId: null, accountId: null, permalink: null })).toEqual({
      id: "7",
    });
  });
});

describe("fromApiReference", () => {
  test("reads a reference back off an entry", () => {
    expect(
      fromApiReference({
        id: "5515",
        group_id: "psi-product",
        account_id: "danielbachhuber",
        permalink: "https://example.com",
      }),
    ).toEqual({
      id: "5515",
      groupId: "psi-product",
      accountId: "danielbachhuber",
      permalink: "https://example.com",
    });
  });

  test("coerces a numeric id to a string", () => {
    // The Chrome extension writes issue numbers, and Harvest hands some of
    // them back as numbers, so comparing without coercion silently misses.
    expect(fromApiReference({ id: 5515 })?.id).toBe("5515");
  });

  test("reads an entry with no reference as null", () => {
    expect(fromApiReference(null)).toBeNull();
    expect(fromApiReference(undefined)).toBeNull();
  });

  test("reads a reference with no usable id as null", () => {
    expect(fromApiReference({ group_id: "psi-product" })).toBeNull();
  });

  test("defaults the optional fields to null", () => {
    expect(fromApiReference({ id: "7" })).toEqual({
      id: "7",
      groupId: null,
      accountId: null,
      permalink: null,
    });
  });
});

describe("matchesReference", () => {
  test("matches on id and group together", () => {
    expect(matchesReference(issue, { externalId: "5515", groupId: "psi-product" })).toBe(true);
  });

  test("rejects the same issue number in a different repository", () => {
    expect(matchesReference(issue, { externalId: "5515", groupId: "other-repo" })).toBe(false);
  });

  test("matches on id alone when the query names no group", () => {
    expect(matchesReference(issue, { externalId: "5515" })).toBe(true);
  });

  test("rejects a different id in the same repository", () => {
    expect(matchesReference(issue, { externalId: "5516", groupId: "psi-product" })).toBe(false);
  });

  test("rejects an entry that carries no reference at all", () => {
    expect(matchesReference(null, { externalId: "5515" })).toBe(false);
  });

  test("rejects an entry whose reference has no group when the query names one", () => {
    const ungrouped = { ...issue, groupId: null };
    expect(matchesReference(ungrouped, { externalId: "5515", groupId: "psi-product" })).toBe(false);
  });
});

describe("sumHoursForReference", () => {
  const entries = [
    { hours: 0.25, externalReference: issue },
    { hours: 0.1666666667, externalReference: issue },
    { hours: 5, externalReference: { ...issue, groupId: "other-repo" } },
    { hours: 3, externalReference: null },
  ];

  test("sums only the entries matching the reference", () => {
    expect(sumHoursForReference(entries, { externalId: "5515", groupId: "psi-product" })).toBeCloseTo(
      0.4166666667,
    );
  });

  test("returns zero when nothing matches", () => {
    expect(sumHoursForReference(entries, { externalId: "9999" })).toBe(0);
  });

  test("returns zero for an empty list", () => {
    expect(sumHoursForReference([], { externalId: "5515" })).toBe(0);
  });
});

import { describe, expect, test } from "vitest";

import { githubItemFromPullRequest, timerDefaultsForItem } from "./github.js";

const row = {
  repo: "octocat/acme-widgets",
  number: 5515,
  title: "Audit areas affected by the stats port",
  url: "https://github.com/octocat/acme-widgets/issues/5515",
};

describe("timerDefaultsForItem", () => {
  test("mirrors the convention the Harvest Chrome extension uses", () => {
    // The extension writes the bare issue number as the id, the repository as
    // the group, and the owner as the account. Matching it exactly is what
    // makes hours tracked in Chrome and in bb add up to one total.
    expect(timerDefaultsForItem(row).externalReference).toEqual({
      id: "5515",
      groupId: "acme-widgets",
      accountId: "octocat",
      permalink: "https://github.com/octocat/acme-widgets/issues/5515",
    });
  });

  test("prefills the note the way the issue reads", () => {
    expect(timerDefaultsForItem(row).notes).toBe(
      "#5515: Audit areas affected by the stats port",
    );
  });

  test("treats a bare repository name as having no owner", () => {
    const defaults = timerDefaultsForItem({ ...row, repo: "acme-widgets" });
    expect(defaults.externalReference.groupId).toBe("acme-widgets");
    expect(defaults.externalReference.accountId).toBeNull();
  });
});

describe("githubItemFromPullRequest", () => {
  const PR = {
    number: 5845,
    title: "Move feature toggles onto the stories resource",
    url: "https://github.com/acme/acme-widgets/pull/5845",
  };

  test("reads the owner and repository out of the pull request url", () => {
    // The host's pull-request DTO carries no repository, so the url is the
    // only place the owner and name can come from.
    expect(githubItemFromPullRequest(PR)?.repo).toBe("acme/acme-widgets");
  });

  test("carries the number and title through untouched", () => {
    const item = githubItemFromPullRequest(PR);
    expect(item?.number).toBe(5845);
    expect(item?.title).toBe(PR.title);
  });

  test("produces the same reference a panel row would for that pull request", () => {
    // A timer started from the thread header has to be countable against the
    // same issue as one started from a panel row, or the hours split in two.
    expect(githubItemFromPullRequest(PR)).toEqual({
      repo: "acme/acme-widgets",
      number: 5845,
      title: PR.title,
      url: PR.url,
    });
  });

  test("has nothing to say about a thread with no pull request", () => {
    expect(githubItemFromPullRequest(null)).toBeNull();
  });

  test("takes the path as it finds it, so an enterprise host works too", () => {
    const item = githubItemFromPullRequest({
      ...PR,
      url: "https://git.acme.example/acme/acme-widgets/pull/5845",
    });
    expect(item?.repo).toBe("acme/acme-widgets");
  });

  test("refuses a url with no repository segment rather than inventing one", () => {
    expect(githubItemFromPullRequest({ ...PR, url: "https://github.com/acme" })).toBeNull();
  });

  test("refuses a url it cannot parse at all", () => {
    expect(githubItemFromPullRequest({ ...PR, url: "not a url" })).toBeNull();
  });
});

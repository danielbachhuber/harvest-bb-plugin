import type { PickerExternalReference } from "../components/timer-picker.js";

export interface IssueTimerDefaults {
  notes: string;
  externalReference: PickerExternalReference;
}

/**
 * What a timer started from a GitHub row should be linked to and called.
 *
 * Exported as `bb-plugin-harvest/github`. This is the one GitHub-specific
 * thing the package ships, kept on its own subpath so the rest of the surface
 * stays generic. Use it if your plugin is about GitHub; ignore it otherwise
 * and build your own reference.
 *
 * Issues and pull requests share one number space per repository, so `#42` is
 * one or the other and never both. That is why one builder serves the issue
 * and pull-request panels alike, and why the Harvest Chrome extension treats
 * `/pull/N` exactly like `/issues/N`.
 *
 * The reference deliberately mirrors the convention the Harvest Chrome
 * extension uses for GitHub: the bare issue number as `id`, the repository as
 * `groupId`, the owner as `accountId`. Harvest can only filter on `id`, so the
 * plugin narrows by group after the fetch. Inventing a tidier composite id
 * here would split the hours tracked in Chrome from the hours tracked in bb,
 * and each total would silently understate the work.
 */
/** The minimum a caller must know about a GitHub issue or pull request. */
export interface GitHubItem {
  /** `owner/repo`, or a bare repository name. */
  repo: string;
  number: number;
  title: string;
  url: string;
}

export function timerDefaultsForItem(row: GitHubItem): IssueTimerDefaults {
  const separator = row.repo.lastIndexOf("/");
  const owner = separator === -1 ? null : row.repo.slice(0, separator);
  const name = separator === -1 ? row.repo : row.repo.slice(separator + 1);

  return {
    notes: `#${row.number}: ${row.title}`,
    externalReference: {
      id: String(row.number),
      groupId: name,
      accountId: owner,
      permalink: row.url,
    },
  };
}

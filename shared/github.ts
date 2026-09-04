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

/**
 * The GitHub item a bb thread is about, from the host's pull-request lookup.
 *
 * `experimental_useSidebarThreadPullRequest` resolves a thread's branch to its
 * pull request but carries no repository, so the url is the only place the
 * owner and name can come from. Parsing it keeps the whole association inside
 * the plugin: nothing has to be registered from a GitHub panel, and a thread
 * started by hand is understood as well as one a panel spawned.
 *
 * The path is taken as it is found rather than matched against github.com, so
 * an enterprise host works the same way. `number` comes from the host's own
 * field rather than the url, because that is the value the rest of bb agrees
 * on.
 */
export function githubItemFromPullRequest(
  pullRequest: { number: number; title: string; url: string } | null,
): GitHubItem | null {
  if (pullRequest === null) return null;

  const repo = repoFromUrl(pullRequest.url);
  if (repo === null) return null;

  return {
    repo,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
  };
}

function repoFromUrl(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }

  const [owner, name] = path.split("/").filter((segment) => segment !== "");
  if (owner === undefined || name === undefined) return null;

  return `${owner}/${name}`;
}

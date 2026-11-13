import { ApiError } from "../http.js";
import { classifyPath, containsSecretLikeValue, scanFiles } from "./scanner.js";

function githubReader(token, fetcher) {
  return async (path) => {
    const response = await fetcher(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ZEVQORA",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404)
      throw new ApiError(
        404,
        "Repository not found. Use a public repository or sign in with GitHub with access to this repository.",
        "REPOSITORY_NOT_FOUND",
      );
    if (!response.ok)
      throw new ApiError(
        response.status === 403 || response.status === 429 ? 429 : 502,
        "GitHub could not complete the request. Check repository access or retry shortly.",
        "GITHUB_UNAVAILABLE",
      );
    const raw = await response.text();
    if (raw.length > 8_000_000)
      throw new ApiError(
        422,
        "This repository is too large for a single scan. Connect server telemetry instead.",
        "REPOSITORY_TOO_LARGE",
      );
    return JSON.parse(raw);
  };
}

export async function readGitHubSource(
  value,
  path,
  { token = "", fetcher = fetch } = {},
) {
  const repository = parseGitHubRepository(value);
  if (
    typeof path !== "string" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    classifyPath(path) !== "source"
  )
    throw new ApiError(
      400,
      "Choose a supported, non-sensitive source file.",
      "VALIDATION",
    );
  const file = await githubReader(
    token,
    fetcher,
  )(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
  );
  if (file.type !== "file" || file.encoding !== "base64" || file.size > 250_000)
    throw new ApiError(
      422,
      "Only source files up to 250 KB can be read.",
      "VALIDATION",
    );
  const text = Buffer.from(file.content, "base64").toString("utf8");
  if (containsSecretLikeValue(text))
    throw new ApiError(
      422,
      "This file contains a secret-like value. Remove embedded credentials before preparing a change.",
      "SENSITIVE_SOURCE",
    );
  return text;
}

export function parseGitHubRepository(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new ApiError(
      400,
      "Enter a GitHub repository URL, for example https://github.com/team/project.",
      "VALIDATION",
    );
  }
  const parts = url.pathname
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2 ||
    !parts.every((p) => /^[A-Za-z0-9_.-]+$/.test(p) && p !== "." && p !== "..")
  )
    throw new ApiError(
      400,
      "Use an HTTPS github.com repository URL without credentials or extra paths.",
      "VALIDATION",
    );
  return {
    owner: parts[0],
    repo: parts[1],
    url: `https://github.com/${parts[0]}/${parts[1]}`,
  };
}

/** Fixed GitHub API hosts only. Never clones or executes repository code. */
export async function scanGitHubRepository(
  value,
  { token = "", fetcher = fetch } = {},
) {
  const repository = parseGitHubRepository(value);
  const get = githubReader(token, fetcher);
  const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  const meta = await get(prefix);
  const tree = await get(
    `${prefix}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`,
  );
  if (tree.truncated)
    throw new ApiError(
      422,
      "GitHub returned an incomplete file tree. Connect telemetry for this repository instead.",
      "REPOSITORY_TOO_LARGE",
    );
  const all = Array.isArray(tree.tree) ? tree.tree : [];
  const candidates = all.filter(
    (f) => f.type === "blob" && classifyPath(f.path) === "source",
  );
  if (
    candidates.length > 250 ||
    candidates.some((f) => f.size > 250_000) ||
    candidates.reduce((sum, f) => sum + (f.size || 0), 0) > 4_000_000
  )
    throw new ApiError(
      422,
      "This repository exceeds the scan limit (250 source files / 4 MB). Connect server telemetry instead.",
      "REPOSITORY_TOO_LARGE",
    );
  const files = [];
  // Bounded concurrency keeps provider pressure and function memory predictable.
  for (let i = 0; i < candidates.length; i += 8) {
    const batch = await Promise.all(
      candidates.slice(i, i + 8).map(async (file) => {
        if (!/^[a-f0-9]{40,64}$/.test(file.sha))
          throw new ApiError(
            502,
            "GitHub returned an invalid file reference.",
            "GITHUB_UNAVAILABLE",
          );
        const blob = await get(`${prefix}/git/blobs/${file.sha}`);
        if (blob.encoding !== "base64" || blob.size > 250_000)
          throw new ApiError(
            422,
            "A source file exceeds the scan limit.",
            "REPOSITORY_TOO_LARGE",
          );
        return {
          path: file.path,
          text: Buffer.from(blob.content, "base64").toString("utf8"),
        };
      }),
    );
    files.push(...batch);
  }
  return {
    root_path: repository.url,
    name: repository.repo,
    ...scanFiles(files),
    skipped_sensitive_paths: all.filter(
      (f) => f.type === "blob" && classifyPath(f.path) === "skipped_sensitive",
    ).length,
  };
}

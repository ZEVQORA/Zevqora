import { describe, expect, it, vi } from "vitest";
import {
  parseGitHubRepository,
  readGitHubSource,
  scanGitHubRepository,
} from "../api/_lib/product/github.js";

describe("remote GitHub scanning", () => {
  it.each([
    "../ai.ts",
    "/src/ai.ts",
    "secrets.ts",
    "node_modules/ai.ts",
    ".env",
  ])(
    "refuses sensitive or traversing source paths %s before fetching",
    async (path) => {
      const fetcher = vi.fn();
      await expect(
        readGitHubSource("https://github.com/team/project", path, { fetcher }),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("reads supported source without a local folder", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        type: "file",
        size: 20,
        encoding: "base64",
        content: Buffer.from("export const value = 1;").toString("base64"),
      }),
    );
    expect(
      await readGitHubSource("https://github.com/team/project", "src/ai.ts", {
        fetcher,
      }),
    ).toBe("export const value = 1;");
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/team/project/contents/src/ai.ts",
    );
  });
  it("accepts canonical repository URLs and strips .git", () => {
    expect(
      parseGitHubRepository("https://github.com/team/project.git"),
    ).toEqual({
      owner: "team",
      repo: "project",
      url: "https://github.com/team/project",
    });
  });
  it.each([
    "http://github.com/team/project",
    "https://github.com.evil.test/team/project",
    "https://127.0.0.1/team/project",
    "https://user:pass@github.com/team/project",
    "https://github.com/team/project/tree/main",
    "https://github.com/team/project?token=secret",
  ])("rejects unsafe or ambiguous URL %s before fetching", async (url) => {
    const fetcher = vi.fn();
    await expect(scanGitHubRepository(url, { fetcher })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("scans safe files from immutable blob references and skips sensitive paths", async () => {
    const sha = "a".repeat(40);
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/team/project"))
        return Response.json({ default_branch: "main" });
      if (url.includes("/git/trees/"))
        return Response.json({
          truncated: false,
          tree: [
            { path: "src/ai.ts", type: "blob", sha, size: 100 },
            {
              path: "credentials.ts",
              type: "blob",
              sha: "b".repeat(40),
              size: 100,
            },
            {
              path: "node_modules/client.ts",
              type: "blob",
              sha: "c".repeat(40),
              size: 100,
            },
          ],
        });
      return Response.json({
        encoding: "base64",
        size: 100,
        content: Buffer.from(
          'const client = new OpenAI();\nconst answer = client.chat.completions.create({ model: "gpt-4o-mini" });',
        ).toString("base64"),
      });
    });
    const result = await scanGitHubRepository(
      "https://github.com/team/project",
      { fetcher, token: "test-only-token" },
    );
    expect(result.files_scanned).toBe(1);
    expect(result.skipped_sensitive_paths).toBe(2);
    expect(result.ai_calls.length).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetcher.mock.calls as unknown as Array<
      [string, RequestInit]
    >) {
      expect(new URL(url).hostname).toBe("api.github.com");
      expect(options.redirect).toBe("error");
      expect(options.headers).toMatchObject({
        Authorization: "Bearer test-only-token",
      });
    }
    expect(JSON.stringify(result)).not.toContain("test-only-token");
  });
  it("refuses truncated trees rather than reporting a complete scan", async () => {
    const fetcher = vi.fn(async (url: string) =>
      Response.json(
        url.includes("/git/trees/")
          ? { truncated: true, tree: [] }
          : { default_branch: "main" },
      ),
    );
    await expect(
      scanGitHubRepository("https://github.com/team/project", { fetcher }),
    ).rejects.toMatchObject({ code: "REPOSITORY_TOO_LARGE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("enforces the source-file bound before fetching any blob", async () => {
    const fetcher = vi.fn(async (url: string) =>
      Response.json(
        url.includes("/git/trees/")
          ? {
              tree: Array.from({ length: 251 }, (_, i) => ({
                path: `file${i}.ts`,
                size: 20,
                type: "blob",
                sha: "a".repeat(40),
              })),
            }
          : { default_branch: "main" },
      ),
    );
    await expect(
      scanGitHubRepository("https://github.com/team/project", { fetcher }),
    ).rejects.toMatchObject({ code: "REPOSITORY_TOO_LARGE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("reports missing/private repositories without returning provider details", async () => {
    const fetcher = vi.fn(
      async () => new Response("secret provider body", { status: 404 }),
    );
    await expect(
      scanGitHubRepository("https://github.com/team/project", { fetcher }),
    ).rejects.toMatchObject({ status: 404, code: "REPOSITORY_NOT_FOUND" });
  });
});

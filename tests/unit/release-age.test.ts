import { describe, expect, it } from "vitest";
import {
  checkReleaseAge,
  registryDependencies,
} from "../../scripts/check-release-age.ts";

const now = Date.parse("2026-10-09T00:00:00Z");
const lock = {
  packages: {
    "": { name: "project", version: "1.0.0" },
    "node_modules/example": {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
    },
  },
};
const registry = (time: Record<string, string>) =>
  (async () => Response.json({ time })) as typeof fetch;

describe("npm release age", () => {
  it("accepts the seven-day boundary and rejects one millisecond newer", async () => {
    await expect(
      checkReleaseAge(lock, {
        now,
        fetcher: registry({ "1.0.0": "2026-10-02T00:00:00Z" }),
      }),
    ).resolves.toBe(1);
    await expect(
      checkReleaseAge(lock, {
        now,
        fetcher: registry({ "1.0.0": "2026-10-02T00:00:00.001Z" }),
      }),
    ).rejects.toThrow("example@1.0.0");
  });
  it("includes nested, optional and aliased versions with one lookup per name", () => {
    expect(
      registryDependencies({
        packages: {
          ...lock.packages,
          "node_modules/parent/node_modules/example": {
            version: "2.0.0",
            optional: true,
            resolved: "https://registry.npmjs.org/example/-/example-2.0.0.tgz",
          },
          "node_modules/alias": {
            name: "@scope/real",
            version: "3.0.0",
            resolved: "https://registry.npmjs.org/@scope/real/-/real-3.0.0.tgz",
          },
        },
      }),
    ).toEqual(
      new Map([
        ["example", new Set(["1.0.0", "2.0.0"])],
        ["@scope/real", new Set(["3.0.0"])],
      ]),
    );
  });
  it("fails when publication metadata is absent or invalid", async () => {
    for (const date of [undefined, "invalid date"]) {
      await expect(
        checkReleaseAge(lock, {
          now,
          fetcher: registry(date ? { "1.0.0": date } : {}),
        }),
      ).rejects.toThrow("公開日を確認できません");
    }
  });
  it("fails on registry errors instead of skipping the package", async () => {
    await expect(
      checkReleaseAge(lock, {
        now,
        fetcher: (async () =>
          new Response(null, { status: 503 })) as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 503");
  });
  it("rejects a tarball for a different version than the checked version", () => {
    expect(() =>
      registryDependencies({
        packages: {
          "node_modules/example": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/example/-/example-2.0.0.tgz",
          },
        },
      }),
    ).toThrow("バージョンが一致しません");
  });
  it("rejects dependencies with no verifiable npm registry source", () => {
    expect(() =>
      registryDependencies({
        packages: {
          "node_modules/example": {
            version: "1.0.0",
            resolved: "git+https://example.com/repo.git",
          },
        },
      }),
    ).toThrow("公開日を検証できない");
  });
});

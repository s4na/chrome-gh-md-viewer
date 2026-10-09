import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WEEK = 7 * 24 * 60 * 60 * 1000;
interface Lockfile {
  packages: Record<
    string,
    {
      name?: string;
      version?: string;
      resolved?: string;
      link?: boolean;
      optional?: boolean;
    }
  >;
}

export function registryDependencies(
  lockfile: Lockfile,
): Map<string, Set<string>> {
  if (!lockfile.packages || typeof lockfile.packages !== "object")
    throw new Error("package-lock.jsonのpackagesを読み取れません。");
  const packages = new Map<string, Set<string>>();
  for (const [location, entry] of Object.entries(lockfile.packages)) {
    if (location === "" || entry.link) continue;
    const name = entry.name ?? location.split("node_modules/").at(-1) ?? "";
    if (
      !/^(@[a-z\d._-]+\/)?[a-z\d._-]+$/i.test(name) ||
      !entry.version ||
      !/^\d+\.\d+\.\d+(?:[-+][a-z\d.-]+)?$/i.test(entry.version) ||
      !entry.resolved?.startsWith("https://registry.npmjs.org/")
    )
      throw new Error(`${location}: npm公開日を検証できない依存です。`);
    const url = new URL(entry.resolved);
    const tarball = `${name.split("/").at(-1)}-${entry.version}.tgz`;
    if (decodeURIComponent(url.pathname) !== `/${name}/-/${tarball}`)
      throw new Error(
        `${location}: 公開日とtarballのバージョンが一致しません。`,
      );
    const versions = packages.get(name) ?? new Set<string>();
    versions.add(entry.version);
    packages.set(name, versions);
  }
  return packages;
}

export async function checkReleaseAge(
  lockfile: Lockfile,
  { now = Date.now(), fetcher = fetch } = {},
): Promise<number> {
  const packages = Array.from(registryDependencies(lockfile));
  const failures: string[] = [];
  for (let offset = 0; offset < packages.length; offset += 6) {
    await Promise.all(
      packages.slice(offset, offset + 6).map(async ([name, versions]) => {
        try {
          const response = await fetcher(
            `https://registry.npmjs.org/${encodeURIComponent(name)}`,
            {
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(20000),
            },
          );
          if (!response.ok)
            throw new Error(`npm registry HTTP ${response.status}`);
          const metadata = (await response.json()) as {
            time?: Record<string, string>;
          };
          for (const version of versions) {
            const published = metadata.time?.[version];
            const timestamp = published ? Date.parse(published) : NaN;
            if (!Number.isFinite(timestamp))
              failures.push(`${name}@${version}: 公開日を確認できません。`);
            else if (now - timestamp < WEEK)
              failures.push(
                `${name}@${version}: 公開日 ${published} は7日未満です。`,
              );
          }
        } catch (error) {
          failures.push(
            `${name}: ${error instanceof Error ? error.message : "公開日の取得に失敗しました。"}`,
          );
        }
      }),
    );
  }
  if (failures.length) throw new Error(failures.sort().join("\n"));
  return packages.reduce((count, [, versions]) => count + versions.size, 0);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
    const count = await checkReleaseAge(lockfile);
    console.log(
      `npm公開日検査: ${count}バージョンすべてが公開から7日以上です。`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

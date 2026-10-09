import manifest from "../extension/manifest.json";

const { version } = manifest;

export const viewerVersion = version;
export const logPrefix = "[GH Markdown Viewer]";
type Metrics = Record<string, number | boolean>;

export function logEvent(stage: string, metrics: Metrics = {}): void {
  console.info(logPrefix, { version, stage, ...metrics });
}

export function logError(
  stage: string,
  error: unknown,
  metrics: Metrics = {},
): void {
  console.error(logPrefix, {
    version,
    stage,
    ...metrics,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { name: "UnknownError", message: String(error) },
  });
}

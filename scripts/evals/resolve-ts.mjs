// Resolve hook: retry extensionless relative / "@/" imports as .ts, .tsx or /index.ts.
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const ROOT = pathToFileURL(resolvePath(process.cwd()) + "/").href;
const CANDIDATES = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, next) {
  const spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), ROOT).href : specifier;
  const local = spec.startsWith(".") || spec.startsWith("file:");
  try {
    return await next(spec, context);
  } catch (error) {
    if (!local || /\.[cm]?[jt]sx?$/.test(spec)) throw error;
    for (const ext of CANDIDATES) {
      try {
        return await next(spec + ext, context);
      } catch {}
    }
    throw error;
  }
}

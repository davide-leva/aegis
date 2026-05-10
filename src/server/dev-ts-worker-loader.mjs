import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { transformSync } from "esbuild";

function resolveSourceSpecifier(specifier, parentURL) {
  if (!parentURL || !specifier.endsWith(".js")) {
    return null;
  }

  const candidateUrl = new URL(specifier, parentURL);
  if (candidateUrl.protocol !== "file:") {
    return null;
  }

  const sourcePath = fileURLToPath(candidateUrl).replace(/\.js$/, ".ts");
  return existsSync(sourcePath) ? pathToFileURL(sourcePath).href : null;
}

export function installDevTsWorkerLoader() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const sourceUrl = resolveSourceSpecifier(specifier, context.parentURL);
      if (sourceUrl) {
        return nextResolve(sourceUrl, context);
      }

      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !url.endsWith(".ts")) {
        return nextLoad(url, context);
      }

      const filename = fileURLToPath(url);
      const source = readFileSync(filename, "utf8");
      const result = transformSync(source, {
        format: "esm",
        loader: "ts",
        sourcemap: "inline",
        sourcefile: filename,
        target: "node22"
      });

      return {
        format: "module",
        shortCircuit: true,
        source: result.code
      };
    }
  });
}

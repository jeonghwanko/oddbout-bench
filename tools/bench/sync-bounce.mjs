import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { benchEnvVersion, benchSources } from "./sources.mjs";

const entry = "src/sim/bench/bounce.ts";
const [source, mode, ...extra] = process.argv.slice(2);
if (!source || (mode && mode !== "--write") || extra.length) {
  throw new Error("usage: node tools/bench/sync-bounce.mjs <path-to-crashbang-heroes/kaito_web> [--write]");
}
const target = fileURLToPath(new URL("../..", import.meta.url));
const sources = benchSources(source, entry);
if (sources.some(file => file !== entry && !file.startsWith("src/sim/bounce/"))) {
  throw new Error("Bounce Ball import closure crossed its simulation boundary");
}
if (mode === "--write") {
  for (const file of sources) {
    const out = path.join(target, file);
    mkdirSync(path.dirname(out), { recursive: true });
    copyFileSync(path.join(source, file), out);
  }
}
const version = benchEnvVersion(source, entry);
if (version !== benchEnvVersion(target, entry)) throw new Error("Bounce Ball source and public environment versions differ");
console.log(`Bounce Ball ${version}: ${sources.length} files match`);

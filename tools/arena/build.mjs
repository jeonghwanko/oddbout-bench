import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { benchEnvVersion, benchSources } from "../bench/sources.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const web = join(repo, "web", "arena");
const date = "2026-11-22";
const archiveCommit = "e8636ce0a339cbaaff2528bebc649eccbf989a03";
const archive = `results/${date}-public/scenarios`;
const caseFile = `${archive}/cases.json`;
const modelFiles = ["gpt-6.2-astra.json", "claude-opus-5-5.json"].map(name => `${archive}/${name}`);
const scenarioIds = ["air-11", "ground-01", "chase-08", "air-04", "air-12", "ground-06", "ground-10", "chase-01", "recovery-06"];
const pageFiles = ["index.html", "arena.css", "arena.js", "arena-core.js", "paint.js", "art"];

function readJson(file) {
  return JSON.parse(readFileSync(join(repo, file), "utf8"));
}

export function buildArena(output = join(repo, "bench-out", "arena")) {
  const cases = readJson(caseFile);
  const envVersion = benchEnvVersion(repo);
  if (cases.envVersion !== envVersion) {
    throw new Error(`Arena archive requires envVersion ${cases.envVersion}. This checkout has ${envVersion}.`);
  }

  execFileSync(process.execPath, ["tools/bench/scenarios.mjs", "verify", "--cases", caseFile, ...modelFiles], {
    cwd: repo,
    stdio: "inherit",
  });

  const logs = modelFiles.map(file => new Map(readJson(file).cases.map(item => [item.id, item])));
  const rounds = scenarioIds.map(id => {
    const scenario = cases.cases.find(item => item.id === id);
    const models = logs.map(log => log.get(id));
    if (!scenario || models.some(item => item?.status !== "ok")) throw new Error(`Missing valid public replays for ${id}`);
    return { ...scenario, models: models.map(({ action, outcome }) => ({ action, outcome })) };
  });

  mkdirSync(output, { recursive: true });
  for (const file of pageFiles) {
    cpSync(join(web, file), join(output, file), { recursive: true });
  }
  for (const file of benchSources(repo)) {
    const target = join(output, file.replace(/^src\//, "").replace(/\.ts$/, ".js"));
    const source = readFileSync(join(repo, file), "utf8").replace(/\r\n/g, "\n");
    const javascript = stripTypeScriptTypes(source).replace(/(\bfrom\s+|\bimport\s+)(["'])(\.\.?\/[^"']+)\2/g, "$1$2$3.js$2");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, javascript);
  }

  const data = { envVersion, commit: archiveCommit, date, horizonS: cases.horizonS, continuation: cases.continuation, rounds };
  writeFileSync(join(output, "replay-data.js"), `// Generated from the verified public benchmark records.\nexport default ${JSON.stringify(data, null, 2)};\n`);
  cpSync(join(repo, "LICENSE"), join(output, "LICENSE-oddbout-bench.txt"));
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Arena build: ${buildArena()}`);
}

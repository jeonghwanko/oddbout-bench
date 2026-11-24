// 벤치 환경의 소스 목록과 환경 판(envVersion). bench.mjs(판 계산)와 export-public.mjs(공개 사본)가 같이 쓴다.
// 목록은 `src/sim/bench/index.ts` 에서 시작해 상대 import(`from "./x"`, `import "./x"`)를 따라간 .ts 파일의 닫힘이다.
// 벤치가 import 하지 않는 파일(미션 · 상점 · 라이벌 등)은 판에 들어가지 않는다. 계약: docs/kaito-web/game-benchmark.md#기록과-환경-판
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const BENCH_ENTRY = "src/sim/bench/index.ts";

/** 저장소(kaito_web) 상대 경로의 .ts 파일 하나가 상대 import 로 부르는 파일들. */
function relativeImports(root, rel) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const specs = [...src.matchAll(/(?:\bfrom\s+|\bimport\s+)["']([^"']+)["']/g)].map(m => m[1]).filter(s => s.startsWith("."));
  return specs.map(spec => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    for (const cand of [base, `${base}.ts`, `${base}/index.ts`]) {
      if (cand.endsWith(".ts") && fs.existsSync(path.join(root, cand)) && fs.statSync(path.join(root, cand)).isFile()) return cand;
    }
    throw new Error(`${rel}: cannot resolve import ${spec}`);
  });
}

/** 벤치 환경의 import 닫힘(경로 차례, `/` 구분). */
export function benchSources(root, entry = BENCH_ENTRY) {
  const seen = new Set(), todo = [entry];
  while (todo.length) {
    const rel = todo.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    todo.push(...relativeImports(root, rel));
  }
  return [...seen].sort();
}

/** 환경 판: 닫힘의 파일마다 상대 경로와 내용(줄 끝 `\r\n` → `\n`)을 sha256 에 넣은 앞 12 글자. */
export function benchEnvVersion(root, entry = BENCH_ENTRY) {
  const h = createHash("sha256");
  for (const f of benchSources(root, entry)) {
    h.update(f); h.update("\0");
    h.update(fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n")); h.update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

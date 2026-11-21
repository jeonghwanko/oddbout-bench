// Node 22+ TypeScript 형 지우기: 확장자 없는 상대 import 에 `.ts` 또는 `/index.ts` 를 붙인다.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (!specifier.startsWith(".")) throw error;
      try { return next(`${specifier}.ts`, context); }
      catch {
        try { return next(`${specifier}/index.ts`, context); }
        catch { throw error; }
      }
    }
  },
});

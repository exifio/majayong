// 테스트 전용: 소스가 tsc용으로 './x.js'를 import하므로 Node가 실행 시 './x.ts'로 해석하게 한다.
// Gate 0에서 공식 테스트 러너(Jest/tsx 등)가 동결되면 삭제한다.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      const candidate = fileURLToPath(url).replace(/\.js$/, '.ts');
      if (existsSync(candidate)) return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
    }
    return nextResolve(specifier, context);
  },
});

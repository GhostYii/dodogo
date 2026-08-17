// DoDoGo 前端构建脚本：esbuild 打包 TypeScript 与 CSS 到 static/assets/
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, 'static', 'assets');
mkdirSync(outdir, { recursive: true });

const shared = {
  bundle: true,
  sourcemap: false,
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: [join(root, 'ts', 'index.ts')],
  outfile: join(outdir, 'app.js'),
  format: 'iife',
  target: 'es2020',
  minify: process.env.NODE_ENV === 'production',
});

await build({
  ...shared,
  entryPoints: [join(root, 'css', 'app.css')],
  outfile: join(outdir, 'app.css'),
  minify: process.env.NODE_ENV === 'production',
});

console.log('✓ 前端构建完成: static/assets/app.js, static/assets/app.css');

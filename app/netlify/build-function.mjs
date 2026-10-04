// Builds the Netlify `api` function as a self-contained ESM bundle.
//
// Why self-bundle: the Netlify esbuild bundler emits CommonJS, which cannot
// represent the legitimate top-level await / import.meta usage in
// server/index.ts. This script bundles with esbuild directly (format ESM)
// and the function is deployed with `node_bundler = "none"` (see the root
// netlify.toml), so Netlify ships the bundle untouched as `api.mjs`.
//
// Outputs (generated at deploy time, never committed):
//   netlify/functions/api.mjs   - the bundled function (discovered by name)
//   netlify/functions/schema.sql - colocated copy; db.ts loads schema.sql
//     relative to its own module, which after bundling is the bundle dir,
//     so the schema file must sit next to api.mjs.
import { build } from 'esbuild'
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [join(here, 'src', 'api.mts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(here, 'functions', 'api.mjs'),
  // pg optionally requires('pg-native'); never bundle native code, and the
  // pure-JS fallback is the intended path (same as plain node).
  external: ['pg-native'],
  banner: {
    // serverless-http is CJS and calls require() for node builtins at
    // runtime; re-create require inside the ESM bundle (esbuild-endorsed
    // pattern) so those calls keep working.
    js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`,
  },
})

// db.ts reads schema.sql next to its own module; ship it next to the bundle.
copyFileSync(join(here, '..', 'server', 'schema.sql'), join(here, 'functions', 'schema.sql'))

console.log('Built netlify/functions/api.mjs + schema.sql')

/**
 * E2E fixture server: builds templates/minimal and runs it on a dedicated port
 * with a fresh PGlite data dir per run. Stdout/stderr are teed to
 * `e2e/.tmp/outer.log` so tests can scrape the email OTP the template prints.
 *
 * Giget'd templates pin a published `@outerjs/server` tarball. Monorepo e2e
 * needs the in-tree package (so changes like `.start()` are picked up), so we
 * rebuild `packages/server` and symlink it into the template before bundling.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const template = path.resolve(root, "templates/minimal");
const serverPkg = path.resolve(root, "packages/server");
const tmp = path.join(here, ".tmp");
const dataDir = path.join(tmp, "data");

// Fresh database every run — CRUD tests assume their rows are the only e2e rows.
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

// 1. Build the monorepo server so the template's import resolves to current APIs.
const serverBuild = spawnSync("bun", ["run", "build"], { cwd: serverPkg, stdio: "inherit" });
if (serverBuild.status !== 0) process.exit(serverBuild.status ?? 1);

// 2. Point the template at the in-tree package (without mutating package.json).
const outerNm = path.join(template, "node_modules", "@outerjs");
fs.mkdirSync(outerNm, { recursive: true });
const linkPath = path.join(outerNm, "server");
fs.rmSync(linkPath, { recursive: true, force: true });
fs.symlinkSync(serverPkg, linkPath, "dir");

// 3. Bundle the fixture against that linked package.
const build = spawnSync("bun", ["x", "tsdown"], { cwd: template, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const log = fs.createWriteStream(path.join(tmp, "outer.log"));
const child = spawn("node", [path.join(template, "dist/index.mjs")], {
  cwd: dataDir,
  env: {
    ...process.env,
    PORT: "3199",
    BASE_URL: "http://localhost:3199",
    ADMIN_EMAIL: "admin@e2e.test",
    COOKIE_PREFIX: "outer-e2e",
    CORS_ORIGINS: "http://localhost:5199",
    AUTH_SECRET: "e2e-only-secret-0123456789abcdefghijklmnop",
  },
});
child.stdout.on("data", (d) => {
  process.stdout.write(d);
  log.write(d);
});
child.stderr.on("data", (d) => {
  process.stderr.write(d);
  log.write(d);
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill());
}

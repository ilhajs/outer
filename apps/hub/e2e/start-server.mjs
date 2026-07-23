/**
 * E2E fixture server: builds templates/minimal and runs it on a dedicated port
 * with a fresh PGlite data dir per run. Stdout/stderr are teed to
 * `e2e/.tmp/outer.log` so tests can scrape the email OTP the template prints.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.resolve(here, "../../../templates/minimal");
const tmp = path.join(here, ".tmp");
const dataDir = path.join(tmp, "data");

// Fresh database every run — CRUD tests assume their rows are the only e2e rows.
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

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

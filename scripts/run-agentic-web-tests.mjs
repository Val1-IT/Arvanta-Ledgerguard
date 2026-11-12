#!/usr/bin/env node
/**
 * Run sites/agentic-web Node tests on Node 20, 22 and 24.
 * Node 20 does not expand a quoted *.test.mjs glob, and a bare folder
 * after --test is rejected on Node 22, so this lists the files itself.
 */
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sites/agentic-web/tests");
const files = (await readdir(dir))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join(dir, name));

if (files.length === 0) {
  console.error(`No *.test.mjs files found in ${dir}`);
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});

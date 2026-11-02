import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectAssets, publishBuild } from "./build.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "moniter-build-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function output(root, generation) {
  const directory = join(root, generation);
  await mkdir(directory);
  const file = `app-${generation.repeat(8)}.js`;
  const lazy = `detail-${generation.repeat(8)}.js`;
  await writeFile(join(directory, "index.html"), `<script src="/ui-assets/${file}"></script>`);
  await writeFile(join(directory, file), `import('./${lazy}')`);
  await writeFile(join(directory, lazy), "export default 1");
  await writeFile(join(directory, "build-manifest.json"), JSON.stringify({
    "index.html": { file, isEntry: true, dynamicImports: ["detail"] },
    detail: { file: lazy, isDynamicEntry: true },
  }));
  return { directory, file, lazy };
}

test("local builds retain one previous generation, including lazy chunks", async t => {
  const root = await fixture(t);
  const destination = join(root, "dist");
  const a = await output(root, "a"), b = await output(root, "b"), c = await output(root, "c");
  await publishBuild(a.directory, destination);
  await publishBuild(b.directory, destination);
  assert((await readdir(destination)).includes(a.lazy));
  await publishBuild(c.directory, destination);
  assert.deepEqual(new Set(await readdir(destination)), new Set([
    "index.html", "build-manifest.json", b.file, b.lazy, c.file, c.lazy,
  ]));
  assert.equal(await readFile(join(destination, "index.html"), "utf8"), await readFile(join(c.directory, "index.html"), "utf8"));
});

test("legacy migration follows the current dependency graph, excluding orphan bundles", async t => {
  const root = await fixture(t);
  const a = await output(root, "a");
  await rm(join(a.directory, "build-manifest.json"));
  await writeFile(join(a.directory, "orphan-12345678.js"), "old");
  assert.deepEqual(await collectAssets(a.directory), new Set([a.file, a.lazy]));
  const b = await output(root, "b");
  await publishBuild(b.directory, a.directory);
  assert(!(await readdir(a.directory)).includes("orphan-12345678.js"));
  assert((await readdir(a.directory)).includes(a.lazy));
});

test("release builds contain only the current generation", async t => {
  const root = await fixture(t);
  const a = await output(root, "a"), b = await output(root, "b");
  await publishBuild(b.directory, a.directory, false);
  assert.deepEqual(new Set(await readdir(a.directory)), new Set(await readdir(b.directory)));
});

test("an incomplete build leaves the existing frontend available", async t => {
  const root = await fixture(t);
  const a = await output(root, "a"), b = await output(root, "b");
  await rm(join(b.directory, "index.html"));
  const before = await readFile(join(a.directory, "index.html"), "utf8");
  await assert.rejects(publishBuild(b.directory, a.directory), /incomplete/);
  assert.equal(await readFile(join(a.directory, "index.html"), "utf8"), before);
});

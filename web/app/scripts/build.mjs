import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestName = "build-manifest.json";
const assetPattern = /\b([\w.-]+-[\w-]{8,}\.(?:js|css|svg|png|jpe?g|webp|woff2?|ico))\b/g;

async function filesIn(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(join(directory, entry.name), relative + "/"));
    else files.push(relative);
  }
  return files;
}

export async function collectAssets(directory) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (manifest) {
    return new Set(Object.values(manifest).flatMap(entry =>
      [entry.file, ...entry.css ?? [], ...entry.assets ?? []].filter(Boolean)));
  }
  // Migrate builds made before manifests were enabled. Follow only actual
  // hashed files referenced by the active HTML and its JS/CSS dependency graph.
  const available = new Set(await filesIn(directory));
  const found = new Set();
  const queue = ["index.html"];
  while (queue.length) {
    const name = queue.pop();
    if (!available.has(name)) continue;
    const source = await readFile(join(directory, name), "utf8");
    for (const match of source.matchAll(assetPattern)) {
      const asset = match[1];
      if (available.has(asset) && !found.has(asset)) {
        found.add(asset);
        if (/\.(js|css)$/.test(asset)) queue.push(asset);
      }
    }
  }
  return found;
}

export async function publishBuild(staging, destination, retainPrevious = true) {
  const previous = retainPrevious ? await collectAssets(destination) : new Set();
  const current = new Set(await filesIn(staging));
  if (!current.has("index.html") || !current.has(manifestName)) {
    throw new Error("The frontend build is incomplete; the current site was left in place.");
  }
  await mkdir(destination, { recursive: true });
  for (const relative of current) {
    if (relative === "index.html") continue;
    await mkdir(dirname(join(destination, relative)), { recursive: true });
    await cp(join(staging, relative), join(destination, relative));
  }
  // Publish HTML after every new dependency exists. Existing tabs can continue
  // importing the immediately preceding build's lazy chunks.
  await writeFile(join(destination, ".index-next.html"), await readFile(join(staging, "index.html")));
  await rename(join(destination, ".index-next.html"), join(destination, "index.html"));
  for (const relative of await filesIn(destination)) {
    if (!current.has(relative) && !previous.has(relative)) {
      await rm(join(destination, relative));
    }
  }
}

async function main() {
  const staging = await mkdtemp(join(tmpdir(), "moniter-frontend-"));
  try {
    await build({
      root: appRoot,
      configFile: join(appRoot, "vite.config.ts"),
      build: { outDir: staging, emptyOutDir: true, manifest: manifestName },
    });
    await publishBuild(staging, resolve(appRoot, "../dist"), !process.argv.includes("--clean"));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

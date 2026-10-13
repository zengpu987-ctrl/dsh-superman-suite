// List packages under a scope inside an asar that declare dsh.bundle (profile bundles).
// Usage: node tools/list-bundles.mjs <archive> <scopeDir e.g. dsh/node_modules/@deepseek-ai>
import { readFileSync } from "node:fs";

const [archive, scope] = process.argv.slice(2);
const fd = readFileSync(archive);
const pickleSize = fd.readUInt32LE(4);
const jsonSize = fd.readUInt32LE(12);
const header = JSON.parse(fd.subarray(16, 16 + jsonSize).toString("utf8"));
const baseOffset = 8 + pickleSize;

function find(target) {
  const parts = target.split("/").filter(Boolean);
  let cur = header;
  for (const part of parts) {
    if (!cur.files || !cur.files[part]) return null;
    cur = cur.files[part];
  }
  return cur;
}
function read(node) {
  const start = baseOffset + Number(node.offset);
  return fd.subarray(start, start + node.size);
}

const scopeNode = find(scope);
const out = [];
for (const [name, value] of Object.entries(scopeNode.files ?? {})) {
  const manifest = value.files?.["package.json"];
  if (!manifest) continue;
  let parsed;
  try {
    parsed = JSON.parse(read(manifest).toString("utf8"));
  } catch {
    continue;
  }
  if (parsed.dsh?.bundle?.patch === undefined) continue;
  out.push({
    name: parsed.name,
    version: parsed.version,
    description: parsed.description ?? "",
    title: parsed.meta?.title ?? "",
    patch: parsed.dsh.bundle.patch,
    client: parsed.dsh?.client ? true : false,
  });
}
out.sort((a, b) => a.name.localeCompare(b.name));
console.log(JSON.stringify(out, null, 2));
console.error(`(${out.length} bundles)`);

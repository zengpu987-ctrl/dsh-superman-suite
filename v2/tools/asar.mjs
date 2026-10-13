// Read-only ASAR inspector.
// Usage:
//   node tools/asar.mjs <archive> list <regex> [maxDepth]
//   node tools/asar.mjs <archive> read <innerPath> [outFile]
//   node tools/asar.mjs <archive> grep <regex> <pathRegex> [maxBytesPerFile]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [archive, cmd, ...rest] = process.argv.slice(2);
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
function readFileNode(node) {
  const start = baseOffset + Number(node.offset);
  return fd.subarray(start, start + node.size);
}
function* walkAll(node, prefix, depth) {
  for (const [name, value] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    yield [p, value, depth];
    if (value.files) yield* walkAll(value, p, depth + 1);
  }
}

if (cmd === "list") {
  const re = new RegExp(rest[0]);
  const maxDepth = rest[1] ? Number(rest[1]) : 99;
  const out = [];
  for (const [p, value, depth] of walkAll(header, "", 1)) {
    if (depth > maxDepth) continue;
    if (re.test(p)) out.push(value.files ? p + "/" : p);
  }
  out.sort();
  console.log(out.join("\n"));
  console.error(`(${out.length} matches)`);
} else if (cmd === "read") {
  const node = find(rest[0]);
  if (!node || node.files) {
    console.error("not a file: " + rest[0]);
    process.exit(1);
  }
  const buf = readFileNode(node);
  if (rest[1]) {
    mkdirSync(dirname(rest[1]), { recursive: true });
    writeFileSync(rest[1], buf);
    console.error(`wrote ${buf.length} bytes -> ${rest[1]}`);
  } else {
    process.stdout.write(buf);
  }
} else if (cmd === "grep") {
  const re = new RegExp(rest[0]);
  const pathRe = new RegExp(rest[1] || ".");
  const cap = rest[2] ? Number(rest[2]) : 200000;
  for (const [p, value, depth] of walkAll(header, "", 1)) {
    if (value.files || !pathRe.test(p)) continue;
    if (value.size > cap) continue;
    let text;
    try {
      text = readFileNode(value).toString("utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (re.test(line)) {
        const trimmed = line.length > 300 ? line.slice(0, 300) + "…" : line;
        console.log(`${p}:${i + 1}: ${trimmed.trim()}`);
      }
    });
  }
} else {
  console.error("unknown command");
  process.exit(2);
}

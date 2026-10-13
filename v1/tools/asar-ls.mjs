// Minimal Electron ASAR reader: list entries or extract a subtree.
// Usage: node asar-ls.mjs <archive> list [prefix] [--dirs-only]
//        node asar-ls.mjs <archive> extract <prefix> <destDir>
import fs from 'node:fs';
import path from 'node:path';

const [, , archive, mode, a, b] = process.argv;

function readHeader(archivePath) {
	const fd = fs.openSync(archivePath, 'r');
	const sizeBuf = Buffer.alloc(8);
	fs.readSync(fd, sizeBuf, 0, 8, null);
	const headerSize = sizeBuf.readUInt32LE(4);
	const headerBuf = Buffer.alloc(headerSize);
	fs.readSync(fd, headerBuf, 0, headerSize, null);
	const start = headerBuf.indexOf(0x7b); // '{'
	const json = headerBuf.slice(start).toString('utf8').replace(/\0+$/, '');
	fs.closeSync(fd);
	return { header: JSON.parse(json), baseOffset: 8 + headerSize };
}

function walk(node, prefix, out, dirsOnly) {
	for (const [name, entry] of Object.entries(node.files ?? {})) {
		const p = prefix === '' ? name : `${prefix}/${name}`;
		if (entry.files !== undefined) {
			out.push(`d ${p}`);
			walk(entry, p, out, dirsOnly);
		} else if (!dirsOnly) {
			out.push(`f ${p} ${entry.size} ${entry.offset}`);
		}
	}
}

const { header, baseOffset } = readHeader(archive);

if (mode === 'list') {
	const prefix = a ?? '';
	let node = header;
	if (prefix !== '') {
		for (const seg of prefix.split('/')) {
			node = node.files?.[seg];
			if (!node) {
				console.error(`no such entry: ${prefix}`);
				process.exit(1);
			}
		}
	}
	const out = [];
	walk(node, prefix, out, process.argv.includes('--dirs-only'));
	console.log(out.join('\n'));
} else if (mode === 'extract') {
	const prefix = a;
	const dest = b;
	let node = header;
	for (const seg of prefix.split('/')) {
		node = node.files?.[seg];
		if (!node) throw new Error(`no such entry: ${prefix}`);
	}
	const fd = fs.openSync(archive, 'r');
	let count = 0;
	let bytes = 0;
	const stack = [[node, prefix]];
	while (stack.length > 0) {
		const [cur, p] = stack.pop();
		for (const [name, entry] of Object.entries(cur.files ?? {})) {
			const cp = `${p}/${name}`;
			if (entry.files !== undefined) {
				stack.push([entry, cp]);
				continue;
			}
			const target = path.join(dest, cp);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			if (entry.link !== undefined) {
				try {
					fs.symlinkSync(entry.link, target);
				} catch {
					/* an existing link target is fine */
				}
				continue;
			}
			const buf = Buffer.alloc(entry.size);
			if (entry.unpacked === true) {
				const unpacked = archive.replace(/app\.asar$/, 'app.asar.unpacked');
				fs.copyFileSync(path.join(unpacked, cp), target);
				count += 1;
				bytes += entry.size;
				continue;
			}
			fs.readSync(fd, buf, 0, entry.size, baseOffset + Number(entry.offset));
			fs.writeFileSync(target, buf);
			count += 1;
			bytes += entry.size;
		}
	}
	fs.closeSync(fd);
	console.error(`extracted ${count} files (${(bytes / 1e6).toFixed(1)} MB) to ${dest}`);
}

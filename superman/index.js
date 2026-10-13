/**
 * Host half of the Superman memory bundle.
 *
 * Superman is a smart folder: everything uploaded in Harness mode or Chat mode
 * lands here, is classified as PDF / image / code / other, and is indexed so a
 * later question can recall it. The memory also keeps conversation and task
 * records, which is what lets two unrelated conversations refer to each other.
 *
 * Two things are served, both on the authenticated `/api` channel:
 *   POST /api/superman/api   — list / store / get / delete / note / recall
 *   GET  /api/superman/file  — the original bytes of one item
 *
 * A dynamic system-prompt section tells the agent what the memory holds and
 * where its files live, so Harness turns "remember" without a tool call. See
 * `API.md` for the frozen browser contract.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Services this bundle needs; `attachments` is optional and read on demand. */
export const inject = ['connection'];

/** Index format version; a mismatch starts a new index. */
const INDEX_VERSION = 1;
/** Longest text preview kept per item, in characters. */
const MAX_PREVIEW_CHARS = 4000;
/** Longest note body kept, in characters. */
const MAX_NOTE_CHARS = 8000;
/** Longest file accepted, in bytes. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Items whose names the prompt digest lists. */
const DIGEST_ITEMS = 24;

/** Extensions that identify code or a program file. */
const CODE_EXTENSIONS = new Set([
	'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'pyw', 'rb', 'go', 'rs', 'java', 'kt',
	'kts', 'scala', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'php', 'swift', 'm', 'mm', 'sh', 'bash',
	'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'proto', 'lua', 'pl', 'r', 'jl', 'dart',
	'hs', 'elm', 'clj', 'ex', 'exs', 'erl', 'nim', 'zig', 'v', 'asm', 's', 'ipynb', 'nb', 'wl', 'wls',
	'ma', 'mt', 'mth', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'json', 'jsonl', 'yaml', 'yml',
	'toml', 'ini', 'cfg', 'conf', 'tex', 'bib', 'dockerfile', 'makefile', 'cmake', 'gradle', 'mod',
]);
/** Extensions that identify an image. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'svg', 'ico', 'avif']);
/** Image media types the classifier reports. */
const IMAGE_MIME = {
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
	bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', ico: 'image/x-icon',
	avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
};

/** Lower-case extension of a file name. */
function extensionOf(name) {
	const lowered = String(name ?? '').toLowerCase();
	const dot = lowered.lastIndexOf('.');
	return dot === -1 || dot === lowered.length - 1 ? '' : lowered.slice(dot + 1);
}

/** Whether a byte prefix matches one signature. */
function startsWith(bytes, signature) {
	if (bytes.length < signature.length) return false;
	for (let index = 0; index < signature.length; index += 1) if (bytes[index] !== signature[index]) return false;
	return true;
}

/** The image's pixel size, read from its own header when that is cheap. */
function imageSize(bytes, extension) {
	try {
		if (extension === 'png' && bytes.length > 24) {
			return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
		}
		if (extension === 'gif' && bytes.length > 10) {
			return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
		}
		if ((extension === 'jpg' || extension === 'jpeg')) {
			let index = 2;
			while (index + 9 < bytes.length) {
				if (bytes[index] !== 0xff) {
					index += 1;
					continue;
				}
				const marker = bytes[index + 1];
				const length = bytes.readUInt16BE(index + 2);
				if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
					return { height: bytes.readUInt16BE(index + 5), width: bytes.readUInt16BE(index + 7) };
				}
				index += 2 + length;
			}
		}
		if (extension === 'webp' && bytes.length > 30) {
			const kind = bytes.toString('latin1', 12, 16);
			if (kind === 'VP8X') return { width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1, height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1 };
		}
	} catch {
		/* a malformed header simply has no size */
	}
	return undefined;
}

/** Decode bytes that may be UTF-8, GBK, or UTF-16 into text. */
function decodeText(bytes) {
	if (bytes.length === 0) return '';
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode(bytes, 'utf-16le', 2);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode(bytes, 'utf-16be', 2);
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decode(bytes, 'utf-8', 3);
	const utf8 = decode(bytes, 'utf-8');
	if (utf8 !== undefined) return utf8;
	for (const label of ['gbk', 'big5', 'shift_jis', 'euc-kr', 'windows-1252']) {
		const candidate = decode(bytes, label);
		if (candidate !== undefined) return candidate;
	}
	return '';
}

/** Decode with one label, or undefined when the bytes are not valid there. */
function decode(bytes, label, skip = 0) {
	try {
		return new TextDecoder(label, { fatal: true }).decode(skip === 0 ? bytes : bytes.subarray(skip));
	} catch {
		return undefined;
	}
}

/** How code-like a text file looks. */
function codeScore(text) {
	const sample = text.slice(0, 4000);
	if (sample.startsWith('#!')) return 10;
	let score = 0;
	for (const pattern of [/^\s*(?:function|def|class|import|from|const|let|var|public|private|fn|func|package)\b/m, /[{};]\s*$/m, /=>|::|->|\|\||&&|\+\+/, /<\/?[a-z][\w-]*>/i, /^\s*#(?:include|define|pragma)\b/m, /\[\[|\]\]|:=|\$[A-Za-z]/]) {
		if (pattern.test(sample)) score += 1;
	}
	return score;
}

/**
 * Classify one upload into the memory's folders.
 * @param name - the file name.
 * @param mime - the declared media type, when known.
 * @param bytes - the file bytes.
 * @returns the category, the media type, and any cheap metadata.
 */
function categorize(name, mime, bytes) {
	const extension = extensionOf(name);
	const declared = String(mime ?? '').toLowerCase();
	if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) || declared === 'application/pdf' || extension === 'pdf') {
		return { category: 'pdf', mime: 'application/pdf' };
	}
	const imageSignature = startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff])
		|| startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) || startsWith(bytes, [0x42, 0x4d])
		|| (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP');
	if (imageSignature || declared.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
		const media = declared.startsWith('image/') ? declared : IMAGE_MIME[extension] ?? 'image/*';
		return { category: 'image', mime: media, ...imageSize(bytes, extension) ?? {} };
	}
	if (CODE_EXTENSIONS.has(extension)) return { category: 'code', mime: declared || 'text/plain' };
	if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { category: 'other', mime: declared || 'application/zip' };
	const head = bytes.subarray(0, 4096);
	let controls = 0;
	for (const byte of head) if (byte === 0 || (byte < 9 && byte !== 0) || (byte > 13 && byte < 32)) controls += 1;
	if (controls / Math.max(1, head.length) > 0.1) return { category: 'other', mime: declared || 'application/octet-stream' };
	const text = decodeText(head);
	if (declared.startsWith('text/') || /\p{L}/u.test(text)) {
		return { category: codeScore(text) >= 2 ? 'code' : 'other', mime: declared || 'text/plain' };
	}
	return { category: 'other', mime: declared || 'application/octet-stream' };
}

/** Split a query into latin words and CJK characters plus bigrams. */
function tokenize(text) {
	const lowered = String(text ?? '').toLowerCase();
	const tokens = new Set();
	for (const word of lowered.split(/[^a-z0-9_+#.]+/u)) {
		if (word.length >= 2 && word.length <= 40) tokens.add(word);
	}
	const cjk = lowered.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu) ?? [];
	for (const [index, character] of cjk.entries()) {
		tokens.add(character);
		const next = cjk[index + 1];
		if (next !== undefined) tokens.add(`${character}${next}`);
	}
	return [...tokens];
}

/** A short human size. */
function humanBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The Superman memory store: one JSON index plus the original files.
 */
class SupermanStore {
	/** @param root - the memory directory. */
	constructor(root) {
		this.root = root;
		this.filesDir = join(root, 'files');
		this.indexPath = join(root, 'index.json');
		this.index = { version: INDEX_VERSION, items: [], notes: [] };
		this.loaded = false;
		/** Serializes writes so two uploads cannot clobber the index. */
		this.writing = Promise.resolve();
	}

	/** Read the index from disk once. */
	async load() {
		if (this.loaded) return;
		await mkdir(this.filesDir, { recursive: true });
		if (existsSync(this.indexPath)) {
			try {
				const parsed = JSON.parse(await readFile(this.indexPath, 'utf8'));
				if (parsed?.version === INDEX_VERSION && Array.isArray(parsed.items) && Array.isArray(parsed.notes)) this.index = parsed;
			} catch {
				/* a damaged index is rebuilt from the files on the next store */
			}
		}
		this.loaded = true;
	}

	/** Write the index atomically. */
	async save() {
		const payload = JSON.stringify(this.index, null, 1);
		this.writing = this.writing.then(async () => {
			const temporary = `${this.indexPath}.tmp`;
			await writeFile(temporary, payload, 'utf8');
			await rename(temporary, this.indexPath);
		});
		return this.writing;
	}

	/**
	 * Store one file.
	 * @param input - name, mime, bytes, source, origin, and optional extracted text.
	 * @returns the stored item.
	 */
	async store(input) {
		await this.load();
		const bytes = input.bytes;
		const digest = createHash('sha256').update(bytes).digest('hex');
		const classified = categorize(input.name, input.mime, bytes);
		const existing = this.index.items.find((item) => item.sha256 === digest && item.name === input.name);
		if (existing !== undefined) {
			existing.addedAt = Date.now();
			if (input.source !== undefined) existing.source = input.source;
			await this.save();
			return existing;
		}
		const id = digest.slice(0, 16);
		await writeFile(join(this.filesDir, id), bytes);
		const text = typeof input.text === 'string' && input.text.trim() !== ''
			? input.text.slice(0, MAX_PREVIEW_CHARS)
			: classified.category === 'code' || classified.category === 'other' ? decodeText(bytes.subarray(0, 32 * 1024)).slice(0, MAX_PREVIEW_CHARS) : '';
		const item = {
			id,
			name: basename(String(input.name ?? 'file')),
			category: classified.category,
			mime: classified.mime,
			bytes: bytes.length,
			addedAt: Date.now(),
			source: input.source ?? 'superman',
			...(input.origin === undefined ? {} : { origin: input.origin }),
			detail: classified.category === 'image' && classified.width !== undefined
				? `${classified.width}×${classified.height} · ${humanBytes(bytes.length)}`
				: humanBytes(bytes.length),
			sha256: digest,
			hasText: text !== '',
			textLength: text.length,
			...(classified.width === undefined ? {} : { width: classified.width, height: classified.height }),
			text,
		};
		this.index.items.push(item);
		await this.save();
		return item;
	}

	/** Create or replace one conversation/task record. */
	async note(input) {
		await this.load();
		const id = String(input.id ?? randomUUID());
		const existing = this.index.notes.find((note) => note.id === id);
		const now = Date.now();
		const next = {
			id,
			kind: input.kind === 'conversation' ? 'conversation' : 'task',
			title: String(input.title ?? '未命名').slice(0, 200),
			text: String(input.text ?? '').slice(0, MAX_NOTE_CHARS),
			source: String(input.source ?? 'unknown'),
			...(input.sessionId === undefined ? {} : { sessionId: String(input.sessionId) }),
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			tags: Array.isArray(input.tags) ? input.tags.slice(0, 12).map((tag) => String(tag).slice(0, 40)) : [],
		};
		if (existing === undefined) this.index.notes.push(next);
		else Object.assign(existing, next);
		if (this.index.notes.length > 500) this.index.notes = this.index.notes.slice(-500);
		await this.save();
		return next;
	}

	/** Remove one item or note, and its file. */
	async delete(id) {
		await this.load();
		const item = this.index.items.find((entry) => entry.id === id);
		if (item !== undefined) {
			this.index.items = this.index.items.filter((entry) => entry.id !== id);
			await rm(join(this.filesDir, item.id), { force: true });
			await this.save();
			return true;
		}
		const before = this.index.notes.length;
		this.index.notes = this.index.notes.filter((entry) => entry.id !== id);
		if (this.index.notes.length !== before) {
			await this.save();
			return true;
		}
		return false;
	}

	/** Read one item's bytes. */
	async readFile(item) {
		return readFile(join(this.filesDir, item.id));
	}

	/** Category counts, sizes, and note count. */
	stats() {
		const categories = { pdf: 0, image: 0, code: 0, other: 0 };
		let bytes = 0;
		for (const item of this.index.items) {
			categories[item.category] = (categories[item.category] ?? 0) + 1;
			bytes += item.bytes;
		}
		return { total: this.index.items.length, bytes, notes: this.index.notes.length, categories };
	}

	/**
	 * Score every item and note against a query and return the best matches.
	 * @param query - the text to recall for.
	 * @param limit - how many matches to return.
	 * @returns scored matches with snippets.
	 */
	recall(query, limit = 6) {
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];
		const scored = [];
		for (const item of this.index.items) {
			const haystack = `${item.name}\n${item.category}\n${item.text ?? ''}`.toLowerCase();
			let score = 0;
			for (const token of tokens) {
				if (item.name.toLowerCase().includes(token)) score += 4;
				const at = haystack.indexOf(token);
				if (at !== -1) {
					score += token.length >= 2 ? 1.5 : 0.6;
					if ((haystack.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length > 3) score += 0.5;
				}
			}
			if (score === 0) continue;
			score += Math.min(1.5, Math.max(0, 1 - (Date.now() - item.addedAt) / (1000 * 60 * 60 * 24 * 30)));
			scored.push({ id: item.id, kind: 'item', name: item.name, category: item.category, score, snippet: snippetOf(item.text ?? '', tokens), bytes: item.bytes, addedAt: item.addedAt, source: item.source });
		}
		for (const note of this.index.notes) {
			const haystack = `${note.title}\n${note.text}`.toLowerCase();
			let score = 0;
			for (const token of tokens) {
				if (note.title.toLowerCase().includes(token)) score += 3;
				if (haystack.includes(token)) score += token.length >= 2 ? 1.2 : 0.5;
			}
			if (score === 0) continue;
			scored.push({ id: note.id, kind: 'note', name: note.title, category: 'dialog', score, snippet: snippetOf(note.text, tokens), bytes: note.text.length, addedAt: note.updatedAt, source: note.source });
		}
		return scored.sort((left, right) => right.score - left.score).slice(0, Math.max(1, Math.min(20, limit)));
	}

	/** The prompt digest: what the memory holds, and where its files are. */
	digest() {
		const stats = this.stats();
		const recent = [...this.index.items].sort((left, right) => right.addedAt - left.addedAt).slice(0, DIGEST_ITEMS);
		const lines = [
			'## 记忆体 Superman（长期记忆）',
			`目录：${this.root}（原文件在 files/，索引为 index.json）`,
			`现有：PDF ${stats.categories.pdf} · 图片 ${stats.categories.image} · 程序 ${stats.categories.code} · 其他 ${stats.categories.other} · 对话/任务记录 ${stats.notes}`,
		];
		if (recent.length > 0) {
			lines.push('最近收录：');
			for (const item of recent) {
				const snippet = (item.text ?? '').replace(/\s+/g, ' ').slice(0, 80);
				lines.push(`- [${item.category}] ${item.name}（${item.detail ?? humanBytes(item.bytes)}${item.source === 'chat' ? '，来自 Chat' : item.source === 'harness' ? '，来自 Harness' : ''}）${snippet === '' ? '' : ` — ${snippet}`}`);
			}
		}
		if (stats.notes > 0) {
			lines.push('最近的对话/任务记录：');
			for (const note of [...this.index.notes].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 6)) {
				lines.push(`- ${note.title}（${note.source}）`);
			}
		}
		lines.push('需要旧材料时，直接读 files/ 下的对应文件或 index.json；引用时说明依据记忆体的哪一项。');
		return lines.join('\n');
	}
}

/** A snippet around the first matching token. */
function snippetOf(text, tokens) {
	if (text === '') return '';
	const lowered = text.toLowerCase();
	let at = -1;
	for (const token of tokens) {
		const found = lowered.indexOf(token);
		if (found === -1) continue;
		if (at === -1 || found < at) at = found;
	}
	if (at === -1) return text.replace(/\s+/g, ' ').slice(0, 200);
	const start = Math.max(0, at - 60);
	return `${start > 0 ? '…' : ''}${text.slice(start, start + 200).replace(/\s+/g, ' ')}`;
}

/** One JSON failure the browser words in its own language. */
function failure(status, code, message) {
	return Response.json({ ok: false, error: { code, message } }, { status });
}

/** Walk any session event payload for attachment references. */
function collectAttachments(value, found, depth = 0) {
	if (depth > 6 || value === null || typeof value !== 'object') return found;
	if (Array.isArray(value)) {
		for (const entry of value) collectAttachments(entry, found, depth + 1);
		return found;
	}
	if (typeof value.attachmentId === 'string' && (typeof value.mediaType === 'string' || typeof value.name === 'string')) {
		found.push(value);
	}
	for (const entry of Object.values(value)) collectAttachments(entry, found, depth + 1);
	return found;
}

/**
 * Register the Superman memory.
 * @param ctx - the Host plugin context.
 * @param config - the Loader row's configuration.
 */
export function apply(ctx, config) {
	const root = String(config?.root ?? 'superman');
	const recallLimit = Number.isFinite(Number(config?.recallLimit)) ? Number(config.recallLimit) : 6;
	const store = new SupermanStore(root);
	/** Attachment ids already copied into the memory, so a session log cannot re-add them. */
	const ingested = new Set();
	/** Per-session record state, kept only in memory. */
	const sessions = new Map();

	/** Answer one `/api/superman/api` command. */
	async function command(body) {
		const action = String(body?.action ?? '');
		if (action === 'list') {
			await store.load();
			return {
				items: store.index.items.map(({ text, ...item }) => ({ ...item, hasText: text !== undefined && text !== '' })),
				notes: store.index.notes,
				stats: store.stats(),
				root: store.root,
			};
		}
		if (action === 'store') {
			if (typeof body?.base64 !== 'string' || body.base64 === '') throw Object.assign(new Error('base64 is required'), { code: 'bad-request' });
			const bytes = Buffer.from(body.base64, 'base64');
			if (bytes.length === 0) throw Object.assign(new Error('the payload is empty'), { code: 'bad-request' });
			if (bytes.length > MAX_FILE_BYTES) throw Object.assign(new Error('the file is too large'), { code: 'too-large' });
			const item = await store.store({
				name: body.name,
				mime: body.mime,
				bytes,
				source: body.source,
				origin: body.origin,
				text: body.text,
			});
			const { text, ...rest } = item;
			return { item: { ...rest, hasText: text !== undefined && text !== '' } };
		}
		if (action === 'note') {
			const note = await store.note(body?.note ?? {});
			return { note };
		}
		if (action === 'get') {
			await store.load();
			const item = store.index.items.find((entry) => entry.id === body?.id);
			if (item !== undefined) return { item };
			const note = store.index.notes.find((entry) => entry.id === body?.id);
			if (note !== undefined) return { item: { ...note, category: 'dialog', name: note.title, bytes: note.text.length, mime: 'text/plain', addedAt: note.updatedAt, hasText: true, textLength: note.text.length } };
			throw Object.assign(new Error('no such item'), { code: 'not-found' });
		}
		if (action === 'delete') {
			const deleted = await store.delete(String(body?.id ?? ''));
			if (!deleted) throw Object.assign(new Error('no such item'), { code: 'not-found' });
			return { deleted: true };
		}
		if (action === 'recall') {
			await store.load();
			const matches = store.recall(String(body?.q ?? ''), Number(body?.limit ?? recallLimit));
			return { matches, digest: renderRecall(matches) };
		}
		throw Object.assign(new Error(`unknown action: ${action}`), { code: 'bad-request' });
	}

	/** Render recall matches as a prompt-ready digest. */
	function renderRecall(matches) {
		if (matches.length === 0) return '';
		const lines = [`【记忆体 Superman｜命中 ${matches.length} 项】`];
		for (const match of matches) {
			const label = match.category === 'dialog' ? '记录' : match.category === 'image' ? '图片' : match.category === 'code' ? '程序' : match.category === 'pdf' ? 'PDF' : '其他';
			lines.push(`- [${label}] ${match.name}${match.snippet === '' ? '' : `：${match.snippet}`}`);
		}
		lines.push('（以上来自长期记忆，需要完整内容时读 files/ 下的原文件。）');
		return lines.join('\n');
	}

	ctx.inject(['connection'], (connectionCtx) => {
		connectionCtx.effect(() => connectionCtx.connection.fetch.register({
			path: '/api/superman/api',
			methods: ['POST'],
			requestBody: 'buffered',
			fetch: async (request) => {
				let body;
				try {
					body = await request.json();
				} catch {
					return failure(400, 'body', 'body is not JSON');
				}
				try {
					return Response.json({ ok: true, value: await command(body) });
				} catch (error) {
					const code = error?.code ?? 'internal';
					const status = code === 'bad-request' ? 400 : code === 'not-found' ? 404 : code === 'too-large' ? 413 : 500;
					return failure(status, code, error instanceof Error ? error.message : String(error));
				}
			},
		}), 'superman: command route');
		connectionCtx.effect(() => connectionCtx.connection.fetch.register({
			path: '/api/superman/file',
			methods: ['GET'],
			requestBody: 'buffered',
			fetch: async (request) => {
				const id = new URL(request.url).searchParams.get('id') ?? '';
				await store.load();
				const item = store.index.items.find((entry) => entry.id === id);
				if (item === undefined) return new Response('not found', { status: 404 });
				try {
					const bytes = await store.readFile(item);
					return new Response(bytes, {
						status: 200,
						headers: {
							'content-type': item.mime === 'image/*' ? 'application/octet-stream' : item.mime,
							'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
							'cache-control': 'no-store',
						},
					});
				} catch {
					return new Response('unreadable', { status: 410 });
				}
			},
		}), 'superman: file route');
	});

	/* The agent's own prompt always describes the memory, so Harness turns recall it. */
	ctx.inject(['systemPrompt'], (promptCtx) => {
		/* Sits with the other "what you have" sections: right after file references. */
		const fileReferenceOrder = promptCtx.systemPrompt.getSectionOrder('FILE_REFERENCE');
		promptCtx.systemPrompt.section({
			name: 'superman-memory',
			order: Number.isFinite(fileReferenceOrder) ? fileReferenceOrder + 1 : 901,
			text: () => {
				try {
					return store.loaded ? store.digest() : '';
				} catch {
					return '';
				}
			},
		});
	});

	/* Harness uploads and turns land in the memory as they are committed. */
	ctx.on('session/event', (session, event) => {
		try {
			const type = event?.type;
			if (type === 'user/message') {
				const text = (event.data?.content ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trim();
				const state = sessions.get(session.id) ?? { firstText: '', turns: 0 };
				if (state.firstText === '' && text !== '') state.firstText = text.slice(0, 300);
				sessions.set(session.id, state);
				ingestAttachments(event.data?.content, session.id, 'harness');
				return;
			}
			if (type === 'assistant/message') {
				const state = sessions.get(session.id);
				if (state !== undefined) {
					const text = (event.data?.message?.content ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trim();
					state.lastText = text.slice(0, 400);
					ingestAttachments(event.data?.message?.content, session.id, 'harness');
				}
				return;
			}
			if (type === 'turn/end') {
				const state = sessions.get(session.id);
				sessions.set(session.id, { ...(state ?? { firstText: '' }), turns: (state?.turns ?? 0) + 1 });
				const next = sessions.get(session.id);
				void store.note({
					id: `session:${String(session.id)}`,
					kind: 'task',
					title: next?.firstText?.replace(/\s+/g, ' ').slice(0, 80) || `会话 ${String(session.id).slice(0, 12)}`,
					text: [`轮次：${next?.turns ?? 1}`, next?.firstText === undefined ? '' : `首问：${next.firstText}`, next?.lastText === undefined ? '' : `最近回答：${next.lastText}`].filter((line) => line !== '').join('\n'),
					source: 'harness',
					sessionId: String(session.id),
					tags: [session.header?.cwd ?? ''].filter((tag) => tag !== ''),
				}).catch(() => {});
				ingestAttachments(event.data, session.id, 'harness');
			}
		} catch {
			/* a memory that throws must never break a session append */
		}
	});

	/**
	 * Copy one turn's attachments into the memory.
	 * @param payload - the event payload to scan.
	 * @param sessionId - the owning session.
	 * @param source - who uploaded it.
	 */
	function ingestAttachments(payload, sessionId, source) {
		const refs = collectAttachments(payload, []);
		if (refs.length === 0) return;
		void (async () => {
			const attachments = ctx.get('attachments');
			if (attachments === undefined) return;
			for (const ref of refs) {
				const key = String(ref.attachmentId);
				if (ingested.has(key)) continue;
				ingested.add(key);
				try {
					if (typeof ref.mediaType === 'string') {
						const stored = await attachments.readImage(ref);
						await store.store({
							name: typeof ref.name === 'string' && ref.name !== '' ? ref.name : `${key.slice(0, 12)}.${stored.ref.mediaType.split('/')[1] ?? 'png'}`,
							mime: stored.ref.mediaType,
							bytes: Buffer.from(stored.data),
							source,
							origin: sessionId,
						});
						continue;
					}
					const chunks = [];
					for await (const chunk of attachments.readFileStream(ref)) chunks.push(Buffer.from(chunk));
					await store.store({
						name: typeof ref.name === 'string' && ref.name !== '' ? ref.name : key.slice(0, 12),
						bytes: Buffer.concat(chunks),
						source,
						origin: sessionId,
					});
				} catch {
					/* a reference the attachment service no longer holds is skipped */
				}
			}
		})();
	}

	/* The Chat panel stores what it uploads and asks the memory what to remember. */
	void store.load().catch(() => {});
}

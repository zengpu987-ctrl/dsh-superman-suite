/**
 * Offline checks for the Superman memory's host half.
 *
 * It loads the real `superman/index.js` against a temporary memory directory and
 * a fake cordis context, then drives both routes: classification, storage,
 * listing, previews, notes, recall, deletion, and the Harness-side capture of a
 * session's images and turns.
 *
 * It also pins the three halves of the host policy that used to be missing:
 * the PDF reader in `superman/pdf.js` (compared directly against the browser
 * half's own extractor through `tools/chat-mode-load.mjs`), BM25 recall, and the
 * compaction/reconciliation policy (`maxItems` / `maxBytes` / `prune` / startup
 * reconciliation).
 *
 * Usage: node tools/superman-host-check.mjs
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { extractPdfText as hostExtractPdfText } from '../superman/pdf.js';
import { loadClient } from './chat-mode-load.mjs';

const failures = [];
/** Record one expectation. */
function check(condition, label, detail) {
	if (condition) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures.push(label);
	console.log(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

const module = await import(join(process.cwd(), 'superman', 'index.js'));

//#region pdf fixtures
/**
 * Assemble a small but structurally real PDF.
 * @param bodies - `[number, body]` pairs in file order; a body is text or bytes.
 * @returns the file bytes.
 */
function pdfOf(bodies) {
	const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
	for (const [number, body] of bodies) {
		parts.push(Buffer.from(`${number} 0 obj\n`, 'latin1'));
		parts.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
		parts.push(Buffer.from('\nendobj\n', 'latin1'));
	}
	parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
	return Buffer.concat(parts);
}

/** One PDF stream object body, deflated when asked. */
function streamBody(data, compress) {
	const raw = compress ? deflateSync(Buffer.from(data, 'latin1')) : Buffer.from(data, 'latin1');
	return Buffer.concat([
		Buffer.from(`<< /Length ${raw.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'),
		raw,
		Buffer.from('\nendstream', 'latin1'),
	]);
}

/**
 * A one-page PDF whose content stream draws `text` in a simple font.
 * @param text - printable ASCII to draw.
 * @param compress - whether to deflate the content stream.
 */
function textPdf(text, compress = false) {
	return pdfOf([
		[1, '<< /Type /Catalog /Pages 2 0 R >>'],
		[2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
		[3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'],
		[4, streamBody(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, compress)],
		[5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
	]);
}

/** A one-page PDF whose Type0 font maps every drawn code through a /ToUnicode CMap. */
function cmapPdf(text) {
	const codes = [...text].map((_, index) => (index + 1).toString(16).padStart(4, '0'));
	const pairs = [...text].map((character, index) => `<${(index + 1).toString(16).padStart(4, '0')}> <${character.charCodeAt(0).toString(16).padStart(4, '0')}>`).join('\n');
	return pdfOf([
		[1, '<< /Type /Catalog /Pages 2 0 R >>'],
		[2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
		[3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'],
		[4, streamBody(`BT /F1 12 Tf 72 720 Td <${codes.join('')}> Tj ET`, false)],
		[5, '<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 6 0 R >>'],
		[6, streamBody(`beginbfchar\n${pairs}\nendbfchar`, false)],
	]);
}

/** A one-page PDF that only fills a rectangle: a scan has no text layer. */
const scannedPdf = pdfOf([
	[1, '<< /Type /Catalog /Pages 2 0 R >>'],
	[2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
	[3, '<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 4 0 R >>'],
	[4, streamBody('0 0 1 rg 10 10 100 100 re f', false)],
]);
/** A PDF header followed by garbage: the reader finds no object to parse. */
const brokenPdf = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.from([0x00, 0xff, 0x28, 0x29, 0x80, 0x81])]);

const plainLayerPdf = textPdf('Superman memory text layer', false);
const compressedLayerPdf = textPdf('Compressed Superman text layer', true);
const glyphLayerPdf = cmapPdf('CMap glyphs decode');
/** The PDF the fake attachment service hands the Harness capture path. */
const sessionPdf = textPdf('Session attachment text layer', false);
//#endregion

//#region harness
/**
 * Boot one memory root against a fake cordis context.
 * @param config - the Loader row's configuration.
 * @returns its routes, its session listener, and the attachments service it reads.
 */
function boot(config) {
	const routes = new Map();
	const listeners = new Map();
	const attachments = {
		async readImage(ref) {
			return { ref: { ...ref, mediaType: ref.mediaType ?? 'image/png', width: 2, height: 2 }, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };
		},
		async *readFileStream(ref) {
			if (ref?.name === 'session-paper.pdf') {
				yield new Uint8Array(sessionPdf);
				return;
			}
			yield new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x41, 0x42]);
		},
	};
	const ctx = {
		inject: (deps, callback) => callback(ctx),
		effect: (fn) => fn(),
		get: (name) => (name === 'attachments' ? attachments : undefined),
		on: (name, handler) => {
			listeners.set(name, handler);
			return () => {};
		},
		connection: {
			fetch: {
				register(route) {
					routes.set(route.path, route);
					return () => {};
				},
			},
		},
		// The system-prompt injection points, so `apply` can register them.
		systemPrompt: {
			section: () => () => {},
			context: () => () => {},
			getSectionOrder: () => 0,
			getContextOrder: () => 0,
		},
	};
	// The prompt section is registered through `ctx.inject(['systemPrompt'], …)`.
	ctx.inject = (deps, callback) => {
		if (deps.includes('systemPrompt')) {
			callback({
				systemPrompt: { section: () => () => {}, context: () => () => {}, getSectionOrder: () => 0, getContextOrder: () => 0 },
			});
			return () => {};
		}
		return callback(ctx);
	};
	module.apply(ctx, config);
	return { routes, listeners, attachments, ctx };
}

const root = await mkdtemp(join(tmpdir(), 'superman-check-'));
const main = boot({ root, recallLimit: 5 });
const routes = main.routes;
const listeners = main.listeners;

check(routes.has('/api/superman/api'), 'the command route is registered');
check(routes.has('/api/superman/file'), 'the file route is registered');

const commandRoute = routes.get('/api/superman/api');
const fileRoute = routes.get('/api/superman/file');
/** Ask one memory root one command. */
async function commandOn(route, body) {
	const response = await route.fetch(new Request('http://127.0.0.1:19387/api/superman/api', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	}));
	return { status: response.status, payload: await response.json() };
}
/** Ask the main memory root one command. */
async function command(body) {
	return commandOn(commandRoute, body);
}

/**
 * Write one handcrafted memory: an index plus the files it references.
 * @param directory - the memory root.
 * @param items - `[id, bytes, addedAt, name]`; `bytes: null` means the file is missing.
 * @param orphans - file names to write without an index entry.
 */
async function craftMemory(directory, items, orphans = []) {
	await mkdir(join(directory, 'files'), { recursive: true });
	const index = {
		version: 1,
		items: items.map(([id, bytes, addedAt, name]) => ({
			id,
			name: name ?? `${id}.txt`,
			category: 'other',
			mime: 'text/plain',
			bytes: bytes === null ? 0 : bytes.length,
			addedAt,
			source: 'superman',
			sha256: id.padEnd(64, '0'),
			hasText: bytes !== null,
			textLength: bytes === null ? 0 : bytes.length,
			text: bytes === null ? '' : bytes.toString('utf8'),
		})),
		notes: [],
	};
	await writeFile(join(directory, 'index.json'), JSON.stringify(index, null, 1), 'utf8');
	for (const [id, bytes] of items) if (bytes !== null) await writeFile(join(directory, 'files', id), bytes);
	for (const name of orphans) await writeFile(join(directory, 'files', name), Buffer.from('orphan'));
}
//#endregion

//#region fixture files
/** A tiny but real PDF. */
const pdfBytes = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
/** A PNG whose header carries its size. */
const pngBytes = (() => {
	const header = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
	header.writeUInt32BE(13, 8);
	header.write('IHDR', 12, 'latin1');
	header.writeUInt32BE(1920, 16);
	header.writeUInt32BE(1080, 20);
	return header;
})();
const codeBytes = Buffer.from('#!/usr/bin/env python3\nimport numpy as np\n\ndef solve(x):\n    return np.sin(x) ** 2\n', 'utf8');
const textBytes = Buffer.from('会议纪要：下周讨论记忆体的联想策略。\n', 'utf8');

const stored = [];
for (const [name, mime, bytes, text] of [
	['论文.pdf', 'application/pdf', pdfBytes, '这里是论文正文，讨论记忆体与联想。'],
	['照片.png', 'image/png', pngBytes, undefined],
	['solver.py', '', codeBytes, undefined],
	['纪要.txt', 'text/plain', textBytes, undefined],
]) {
	const result = await command({ action: 'store', name, mime, base64: bytes.toString('base64'), source: 'chat', text });
	check(result.payload.ok === true, `store accepts ${name}`, JSON.stringify(result.payload).slice(0, 120));
	stored.push(result.payload.value?.item);
}
const [pdf, image, code, note] = stored;
check(pdf?.category === 'pdf', 'a PDF lands in the PDF folder', pdf?.category);
check(image?.category === 'image' && image.width === 1920 && image.height === 1080, 'a PNG lands in the image folder with its pixel size', `${image?.category}/${image?.width}x${image?.height}`);
check(code?.category === 'code', 'a python file lands in the program folder', code?.category);
check(note?.category === 'other', 'a plain note lands in the other folder', note?.category);
check(pdf?.detail?.includes('KB') === true || pdf?.detail?.includes('B') === true, 'the item carries a human size', pdf?.detail);

const listed = await command({ action: 'list' });
const value = listed.payload.value;
check(value.items.length === 4 && value.notes.length === 0, 'list returns every stored item', `${value.items.length}`);
check(value.stats.categories.pdf === 1 && value.stats.categories.image === 1 && value.stats.categories.code === 1 && value.stats.categories.other === 1, 'stats count each folder', JSON.stringify(value.stats.categories));
check(value.root === root, 'list reports the memory root', value.root);
check(existsSync(join(root, 'files', pdf.id)), 'the original bytes are kept on disk');
check(existsSync(join(root, 'index.json')), 'the index is written');

const got = await command({ action: 'get', id: code.id });
check(got.payload.value.item.text.includes('import numpy'), 'get returns the stored text preview', String(got.payload.value.item.text).slice(0, 40));
const gotPdf = await command({ action: 'get', id: pdf.id });
check(gotPdf.payload.value.item.text.includes('记忆体'), 'a caller-extracted text is kept for recall', String(gotPdf.payload.value.item.text).slice(0, 40));

const fileResponse = await fileRoute.fetch(new Request(`http://127.0.0.1:19387/api/superman/file?id=${image.id}`));
const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
check(fileResponse.status === 200 && fileResponse.headers.get('content-type') === 'image/png', 'the file route answers with the item media type', String(fileResponse.headers.get('content-type')));
check(fileBytes.length === pngBytes.length && fileBytes[0] === 0x89, 'the file route returns the original bytes');
check((await fileRoute.fetch(new Request('http://127.0.0.1:19387/api/superman/file?id=nope'))).status === 404, 'an unknown file id is a 404');

const created = await command({ action: 'note', note: { id: 'session:abc', kind: 'task', title: '整理记忆体', text: '讨论了 PDF 归类与联想', source: 'harness', sessionId: 'abc' } });
check(created.payload.value.note.id === 'session:abc' && created.payload.value.note.kind === 'task', 'a task record is created');
await command({ action: 'note', note: { id: 'session:abc', kind: 'task', title: '整理记忆体（更新）', text: '补充：图片也要归类', source: 'harness', sessionId: 'abc' } });
const afterNote = await command({ action: 'list' });
check(afterNote.payload.value.notes.length === 1 && afterNote.payload.value.notes[0].title.includes('更新'), 'a record with the same id is updated, not duplicated', String(afterNote.payload.value.notes.length));

const recalled = await command({ action: 'recall', q: '记忆体的联想策略是怎么讨论的？' });
check(recalled.payload.value.matches.length > 0, 'recall finds related material', JSON.stringify(recalled.payload.value.matches.map((match) => match.name)));
check(recalled.payload.value.digest.includes('记忆体 Superman') && recalled.payload.value.digest.includes('命中'), 'recall renders a prompt-ready digest', recalled.payload.value.digest.split('\n')[0]);
check((await command({ action: 'recall', q: 'numpy' })).payload.value.matches.some((match) => match.id === code.id), 'recall matches file contents, not only names');
check((await command({ action: 'recall', q: '' })).payload.value.digest === '', 'an empty question recalls nothing');

const bad = await command({ action: 'nonsense' });
check(bad.status === 400 && bad.payload.ok === false && bad.payload.error.code === 'bad-request', 'an unknown action is refused', JSON.stringify(bad.payload));
check((await command({ action: 'store', name: 'x' })).status === 400, 'a store without a payload is refused');
check((await command({ action: 'get', id: 'missing' })).status === 404, 'an unknown id is a 404');

const removed = await command({ action: 'delete', id: note.id });
check(removed.payload.value.deleted === true && !existsSync(join(root, 'files', note.id)), 'deleting removes the item and its file');
check((await command({ action: 'list' })).payload.value.items.length === 3, 'the list shrinks after a delete');

// Harness-side capture: an image in a user turn and a finished turn.
const sessionEvent = listeners.get('session/event');
check(typeof sessionEvent === 'function', 'the host listens to the session log');
if (typeof sessionEvent === 'function') {
	const session = { id: 'session-test', header: { cwd: '/tmp/ws' } };
	sessionEvent(session, {
		type: 'user/message',
		data: { content: [{ type: 'text', text: '看看这张图' }, { type: 'image', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 8, width: 2, height: 2, name: 'harness-shot.png' } }] },
	});
	sessionEvent(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '这是一张测试图。' }] } } });
	sessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
	await new Promise((resolve) => setTimeout(resolve, 120));
	const afterHarness = await command({ action: 'list' });
	const harnessImage = afterHarness.payload.value.items.find((item) => item.name === 'harness-shot.png');
	check(harnessImage !== undefined && harnessImage.source === 'harness', 'a Harness image upload is captured into the memory', harnessImage?.name);
	check(afterHarness.payload.value.notes.some((record) => record.sessionId === 'session-test' && record.kind === 'task'), 'a Harness turn is recorded as a task');
	const record = afterHarness.payload.value.notes.find((entry) => entry.sessionId === 'session-test');
	check(record?.title === '看看这张图', 'the task record is titled by the first question', record?.title);
	sessionEvent(session, { type: 'user/message', data: { content: [{ type: 'image', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 8, width: 2, height: 2, name: 'harness-shot.png' } }] } });
	await new Promise((resolve) => setTimeout(resolve, 80));
	check((await command({ action: 'list' })).payload.value.items.filter((item) => item.name === 'harness-shot.png').length === 1, 'the same attachment is never stored twice');

	// A PDF attachment with no declared media type arrives through the file stream.
	sessionEvent(session, { type: 'user/message', data: { content: [{ type: 'file', attachment: { attachmentId: 'sha256:paper', bytes: sessionPdf.length, name: 'session-paper.pdf' } }] } });
	await new Promise((resolve) => setTimeout(resolve, 150));
	const harnessPdf = (await command({ action: 'list' })).payload.value.items.find((item) => item.name === 'session-paper.pdf');
	check(harnessPdf !== undefined && harnessPdf.category === 'pdf' && harnessPdf.hasText === true, 'a PDF captured from a Harness session is stored with its own text', `${harnessPdf?.category}/${harnessPdf?.hasText}`);
}

check((await commandRoute.fetch(new Request('http://127.0.0.1:19387/api/superman/api', { method: 'POST', body: 'not json' }))).status === 400, 'a non-JSON body is refused');

//#region pdf text on store
const layerStore = await command({ action: 'store', name: 'text-layer.pdf', mime: 'application/pdf', base64: plainLayerPdf.toString('base64'), source: 'superman' });
const compressedStore = await command({ action: 'store', name: 'compressed-layer.pdf', mime: 'application/pdf', base64: compressedLayerPdf.toString('base64'), source: 'superman' });
const glyphStore = await command({ action: 'store', name: 'glyph-layer.pdf', mime: 'application/pdf', base64: glyphLayerPdf.toString('base64'), source: 'superman' });
const layerItem = layerStore.payload.value?.item;
check(Array.isArray(layerStore.payload.value?.evicted) && layerStore.payload.value.evicted.length === 0, 'the store reply carries the eviction list', JSON.stringify(layerStore.payload.value?.evicted));
check(layerItem?.hasText === true && layerItem.textLength > 0, 'a PDF text layer is extracted when the file is stored', `${layerItem?.hasText}/${layerItem?.textLength}`);
const layerText = (await command({ action: 'get', id: layerItem.id })).payload.value.item.text;
check(String(layerText).includes('Superman memory text layer'), 'get returns the text the reader extracted from the PDF', String(layerText?.length));
check(layerItem.pages === 1 && String(layerItem.detail).includes('页'), 'the extracted PDF carries its page count', `${layerItem.pages}/${layerItem.detail}`);
check(compressedStore.payload.value?.item.hasText === true, 'a FlateDecode text layer is extracted too', String(compressedStore.payload.value?.item.textLength));
check(glyphStore.payload.value?.item.hasText === true, 'a Type0 text layer is decoded through its /ToUnicode CMap', String(glyphStore.payload.value?.item.textLength));

const scanStore = await command({ action: 'store', name: 'scan.pdf', mime: 'application/pdf', base64: scannedPdf.toString('base64'), source: 'superman' });
check(scanStore.payload.ok === true && scanStore.payload.value.item.hasText === false, 'a scanned PDF stores without text and without throwing', String(scanStore.payload.value?.item?.hasText));
const brokenStore = await command({ action: 'store', name: 'broken.pdf', mime: 'application/pdf', base64: brokenPdf.toString('base64'), source: 'superman' });
const brokenOnDisk = await readFile(join(root, 'files', brokenStore.payload.value.item.id));
check(brokenStore.payload.ok === true && Buffer.compare(brokenOnDisk, brokenPdf) === 0, 'a PDF the reader cannot parse still stores its bytes', String(brokenStore.payload.value?.item?.hasText));

let tolerant = true;
for (const hostile of [Buffer.alloc(0), Buffer.from('%PDF-', 'latin1'), Buffer.alloc(4096, 0x28), Buffer.from('%PDF-1.7\ntrash', 'latin1'), new Uint8Array(2048).fill(0xff)]) {
	try {
		await hostExtractPdfText(hostile);
	} catch {
		tolerant = false;
	}
}
check(tolerant, 'the reader never throws on malformed input');
//#endregion

//#region extraction parity
const chatHalf = loadClient('chat-mode').module;
const browserExtractPdfText = chatHalf.internal.extractPdfText;
/** Run both readers over one file and say whether they agree. */
async function readersAgree(bytes) {
	const browser = await browserExtractPdfText(bytes);
	const host = await hostExtractPdfText(bytes);
	return {
		agree: (browser.note ?? null) === (host.note ?? null) && browser.text === host.text && (browser.pages ?? 0) === (host.pages ?? 0),
		summary: `browser ${browser.note ?? 'text'}/${browser.text.length}/${browser.pages ?? 0} vs host ${host.note ?? 'text'}/${host.text.length}/${host.pages ?? 0}`,
	};
}

const paperDir = join(process.cwd(), 'papers');
let realPdfs = [];
try {
	realPdfs = (await readdir(paperDir)).filter((name) => name.toLowerCase().endsWith('.pdf'));
} catch {
	realPdfs = [];
}
let realAgreed = 0;
let realDetail = '';
for (const name of realPdfs) {
	const result = await readersAgree(new Uint8Array(await readFile(join(paperDir, name))));
	if (result.agree) realAgreed += 1;
	else if (realDetail === '') realDetail = `${name}: ${result.summary}`;
}
check(realPdfs.length > 0 && realAgreed === realPdfs.length, `the host reader and the browser reader agree on all ${realPdfs.length} real PDF(s) in papers/`, realDetail);

const syntheticPdfs = [
	['plain text layer', plainLayerPdf],
	['compressed text layer', compressedLayerPdf],
	['ToUnicode CMap', glyphLayerPdf],
	['scan without a text layer', scannedPdf],
	['unparseable bytes', brokenPdf],
];
let syntheticAgreed = 0;
let syntheticDetail = '';
for (const [label, bytes] of syntheticPdfs) {
	const result = await readersAgree(bytes);
	if (result.agree) syntheticAgreed += 1;
	else if (syntheticDetail === '') syntheticDetail = `${label}: ${result.summary}`;
}
check(syntheticAgreed === syntheticPdfs.length, 'the host reader and the browser reader agree on every synthetic PDF', syntheticDetail);
const plainRead = await hostExtractPdfText(plainLayerPdf);
check(plainRead.text.includes('Superman memory text layer') && plainRead.pages === 1, 'the synthetic PDF really carries the text both readers must find', `${plainRead.text.length}/${plainRead.pages}`);
//#endregion

//#region bm25
const bm25Root = await mkdtemp(join(tmpdir(), 'superman-bm25-'));
const bm25Memory = boot({ root: bm25Root });
const bm25Route = bm25Memory.routes.get('/api/superman/api');
const bm25Items = [];
for (const [name, text] of [['rare-zebra-notes.txt', 'zebra sighting'], ['common.txt', 'the '.repeat(30).trim()], ['filler.txt', 'the quick brown fox']]) {
	const result = await commandOn(bm25Route, { action: 'store', name, base64: Buffer.from(`body of ${name}`).toString('base64'), source: 'superman', text });
	bm25Items.push(result.payload.value.item);
}
const rareQuery = await commandOn(bm25Route, { action: 'recall', q: 'zebra the' });
check(rareQuery.payload.value.matches[0]?.id === bm25Items[0].id, 'BM25 ranks the rare-term document above a repeated common term', JSON.stringify(rareQuery.payload.value.matches.map((match) => `${match.name}:${match.score.toFixed(3)}`)));
const rareOnly = (await commandOn(bm25Route, { action: 'recall', q: 'zebra' })).payload.value.matches[0];
const commonOnly = (await commandOn(bm25Route, { action: 'recall', q: 'the' })).payload.value.matches[0];
check(rareOnly.score > commonOnly.score, 'a term every document carries scores below a rare term', `${rareOnly.score.toFixed(3)} vs ${commonOnly.score.toFixed(3)}`);
check(module.internal.idf(3, 3) > 0 && module.internal.idf(3, 3) * 5 < module.internal.idf(1, 3), 'idf gives a term present in every document almost no weight', `${module.internal.idf(3, 3).toFixed(4)} vs ${module.internal.idf(1, 3).toFixed(4)}`);
//#endregion

//#region compaction
const capRoot = await mkdtemp(join(tmpdir(), 'superman-cap-'));
const capRoute = boot({ root: capRoot, maxItems: 3 }).routes.get('/api/superman/api');
const capStored = [];
for (let index = 0; index < 4; index += 1) {
	const result = await commandOn(capRoute, { action: 'store', name: `cap-${index}.txt`, base64: Buffer.from(`cap item ${index} ${'x'.repeat(24)}`).toString('base64') });
	capStored.push(result.payload.value);
}
const capEviction = capStored[3].evicted;
check(capEviction.length === 1 && capEviction[0].id === capStored[0].item.id, 'maxItems evicts the oldest item and reports it', JSON.stringify(capEviction.map((entry) => entry.name)));
check(!existsSync(join(capRoot, 'files', capStored[0].item.id)), 'the evicted item file is deleted from disk');
const capped = (await commandOn(capRoute, { action: 'list' })).payload.value;
check(capped.items.length === 3 && !capped.items.some((item) => item.id === capStored[0].item.id), 'the evicted item leaves the index too', String(capped.items.length));
check(capped.stats.evicted === 1 && typeof capped.stats.orphanFiles === 'number', 'stats carries the evicted and orphanFiles counters', JSON.stringify(capped.stats));

const byteRoot = await mkdtemp(join(tmpdir(), 'superman-bytes-'));
const byteRoute = boot({ root: byteRoot, maxBytes: 300 }).routes.get('/api/superman/api');
const byteItems = [];
let peakBytes = 0;
for (let index = 0; index < 5; index += 1) {
	const result = await commandOn(byteRoute, { action: 'store', name: `byte-${index}.txt`, base64: Buffer.alloc(100, 0x61 + index).toString('base64') });
	byteItems.push(result.payload.value.item);
	peakBytes = Math.max(peakBytes, (await commandOn(byteRoute, { action: 'list' })).payload.value.stats.bytes);
}
check(peakBytes <= 300, 'maxBytes holds after every store', String(peakBytes));
check(byteItems.slice(0, 2).every((item) => !existsSync(join(byteRoot, 'files', item.id))) && existsSync(join(byteRoot, 'files', byteItems[4].id)), 'the byte cap evicts oldest-first and deletes those files');
check((await readdir(join(byteRoot, 'files'))).length === 3, 'the byte cap leaves exactly the files the index references', String((await readdir(join(byteRoot, 'files'))).length));

const pruneRoot = await mkdtemp(join(tmpdir(), 'superman-prune-'));
const pruneItems = [0, 1, 2, 3].map((index) => [`prune0000000000${index}`, Buffer.from(`prune item ${index}`), 1_000 + index, `prune-${index}.txt`]);
await craftMemory(pruneRoot, pruneItems);
const pruneRoute = boot({ root: pruneRoot, maxItems: 2 }).routes.get('/api/superman/api');
const pruned = (await commandOn(pruneRoute, { action: 'prune' })).payload.value;
const freedExpected = pruneItems[0][1].length + pruneItems[1][1].length;
const bytesExpected = pruneItems[2][1].length + pruneItems[3][1].length;
check(pruned.removed === 2 && pruned.freedBytes === freedExpected && pruned.items === 2 && pruned.bytes === bytesExpected, 'prune reports what the policy removed', JSON.stringify(pruned));
check(!existsSync(join(pruneRoot, 'files', pruneItems[0][0])) && !existsSync(join(pruneRoot, 'files', pruneItems[1][0])) && existsSync(join(pruneRoot, 'files', pruneItems[3][0])), 'prune deletes the evicted files and keeps the rest');

const reconcileRoot = await mkdtemp(join(tmpdir(), 'superman-reconcile-'));
await craftMemory(reconcileRoot, [['keep00000000000a', Buffer.from('kept bytes'), 2_000, 'kept.txt'], ['gone00000000000b', null, 1_000, 'gone.txt']], ['orphan-no-entry.bin']);
const reconcileRoute = boot({ root: reconcileRoot }).routes.get('/api/superman/api');
const reconciled = (await commandOn(reconcileRoute, { action: 'list' })).payload.value;
check(reconciled.items.length === 1 && reconciled.items[0].id === 'keep00000000000a', 'reconciliation drops an index entry whose file is missing', JSON.stringify(reconciled.items.map((item) => item.id)));
check(!existsSync(join(reconcileRoot, 'files', 'orphan-no-entry.bin')), 'reconciliation deletes a file no entry references');
check(existsSync(join(reconcileRoot, 'files', 'keep00000000000a')), 'reconciliation never deletes a file an entry references');
let rewritten = undefined;
try {
	rewritten = JSON.parse(await readFile(join(reconcileRoot, 'index.json'), 'utf8'));
} catch {
	rewritten = undefined;
}
check(rewritten?.items?.length === 1 && rewritten.items[0].id === 'keep00000000000a', 'reconciliation rewrote the index once', String(rewritten?.items?.length));
check(reconciled.stats.orphanFiles >= 1, 'stats counts the orphans reconciliation removed', String(reconciled.stats.orphanFiles));

const writeRoot = await mkdtemp(join(tmpdir(), 'superman-write-'));
const writeRoute = boot({ root: writeRoot }).routes.get('/api/superman/api');
const burst = await Promise.all([...Array(8)].map((_, index) => commandOn(writeRoute, { action: 'store', name: `burst-${index}.txt`, base64: Buffer.from(`burst body ${index}`).toString('base64') })));
let burstIndex = undefined;
try {
	burstIndex = JSON.parse(await readFile(join(writeRoot, 'index.json'), 'utf8'));
} catch {
	burstIndex = undefined;
}
check(burst.every((result) => result.payload.ok === true) && burstIndex?.items?.length === 8, 'a concurrent store burst leaves index.json valid and complete', String(burstIndex?.items?.length));
check(!existsSync(join(writeRoot, 'index.json.tmp')) && (await readdir(join(writeRoot, 'files'))).length === 8, 'the atomic write leaves no temporary index behind');
//#endregion

for (const directory of [root, bm25Root, capRoot, byteRoot, pruneRoot, reconcileRoot, writeRoot]) await rm(directory, { recursive: true, force: true });
check(!existsSync(root), 'the temporary memory directory is cleaned up');

console.log('');
if (failures.length > 0) {
	console.log(`${failures.length} check(s) failed`);
	for (const failure of failures) console.log(` - ${failure}`);
	process.exit(1);
}
console.log('all checks passed');

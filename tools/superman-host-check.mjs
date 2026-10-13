/**
 * Offline checks for the Superman memory's host half.
 *
 * It loads the real `superman/index.js` against a temporary memory directory and
 * a fake cordis context, then drives both routes: classification, storage,
 * listing, previews, notes, recall, deletion, and the Harness-side capture of a
 * session's images and turns.
 *
 * Usage: node tools/superman-host-check.mjs
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

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

const root = await mkdtemp(join(tmpdir(), 'superman-check-'));
const routes = new Map();
const listeners = new Map();
const savedImages = [];
const attachments = {
	async readImage(ref) {
		return { ref: { ...ref, mediaType: ref.mediaType ?? 'image/png', width: 2, height: 2 }, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };
	},
	async *readFileStream(ref) {
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

const module = await import(join(process.cwd(), 'superman', 'index.js'));
module.apply(ctx, { root, recallLimit: 5 });
check(routes.has('/api/superman/api'), 'the command route is registered');
check(routes.has('/api/superman/file'), 'the file route is registered');

const commandRoute = routes.get('/api/superman/api');
const fileRoute = routes.get('/api/superman/file');
/** Ask the memory one command. */
async function command(body) {
	const response = await commandRoute.fetch(new Request('http://127.0.0.1:19387/api/superman/api', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	}));
	return { status: response.status, payload: await response.json() };
}

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
}

check((await commandRoute.fetch(new Request('http://127.0.0.1:19387/api/superman/api', { method: 'POST', body: 'not json' }))).status === 400, 'a non-JSON body is refused');

await rm(root, { recursive: true, force: true });
check(!existsSync(root), 'the temporary memory directory is cleaned up');

console.log('');
if (failures.length > 0) {
	console.log(`${failures.length} check(s) failed`);
	for (const failure of failures) console.log(` - ${failure}`);
	process.exit(1);
}
console.log('all checks passed');

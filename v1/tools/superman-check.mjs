/**
 * Offline integration check for the Superman memory bundle, run before each
 * install.
 *
 * It loads the real browser half with the shared stub React, registers it
 * against a fake cordis context (locale, effect, slots only), and drives it
 * through a stubbed `fetch` that answers the frozen `/api/superman/api`
 * contract with a canned folder. Passing proves the panel renders tabs, cards,
 * records, uploads, deletes, and error states against the shipped file rather
 * than a copy.
 *
 * Usage: node tools/superman-check.mjs
 */
import { loadClient } from './chat-mode-load.mjs';

/** Collect the text nodes of one rendered tree. */
function textOf(node, out = []) {
	if (node === null || node === undefined || node === false || node === true) return out;
	if (Array.isArray(node)) {
		for (const child of node) textOf(child, out);
		return out;
	}
	if (typeof node === 'string' || typeof node === 'number') {
		out.push(String(node));
		return out;
	}
	if (typeof node.type === 'function') {
		reactStub.reset();
		textOf(node.type(node.props), out);
		return out;
	}
	for (const child of node.children ?? []) textOf(child, out);
	return out;
}

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

const { module, reactStub, styleTags } = loadClient('superman');
const { internal } = module;
const { React } = reactStub;

//#region static shape
check(module.PKG === '@local/dsh-superman', 'client bundle registers its factory under the package id');
check(module.NS === 'superman', 'the locale namespace is superman');
check(module.PANEL_ID === 'superman', 'the sidebar/panel id is superman');
check(internal !== undefined, 'client bundle exposes its internals for checks');
check(Array.isArray(module.inject) && module.inject.includes('slots') && module.inject.includes('locale'), 'the bundle injects slots and locale', JSON.stringify(module.inject));

const zhKeys = Object.keys(internal.zh).sort();
const enKeys = Object.keys(internal.en).sort();
check(zhKeys.length === enKeys.length && zhKeys.every((key, index) => key === enKeys[index]), 'zh and en key sets match', zhKeys.filter((key) => !enKeys.includes(key)).join(','));

/** Flatten a React element tree into tags, text, nodes, and injected markup. */
function flatten(node, out = { tags: [], text: [], html: [], nodes: [] }) {
	if (node === null || node === undefined || node === false || node === true) return out;
	if (Array.isArray(node)) {
		for (const child of node) flatten(child, out);
		return out;
	}
	if (typeof node === 'string' || typeof node === 'number') {
		out.text.push(String(node));
		return out;
	}
	if (typeof node.type === 'function') {
		reactStub.reset();
		flatten(node.type(node.props), out);
		return out;
	}
	if (typeof node.type === 'symbol') {
		for (const child of node.children ?? []) flatten(child, out);
		return out;
	}
	out.tags.push(node.type);
	out.nodes.push(node);
	if (node.props?.dangerouslySetInnerHTML?.__html !== undefined) out.html.push(node.props.dangerouslySetInnerHTML.__html);
	for (const child of node.children ?? []) flatten(child, out);
	return out;
}
//#endregion

//#region boot
/**
 * Register the browser half against a fake cordis context, the way the page does.
 * @returns the registrations, the panel props, and the memory store.
 */
function boot() {
	const registrations = [];
	const dictionaries = [];
	const fakeContext = {
		locale: {
			bind: () => (key) => key,
			register: (ns, dicts) => {
				dictionaries.push({ ns, dicts });
				return () => {};
			},
		},
		effect: (fn) => fn(),
		slots: {
			inject: (key, callback) => {
				const produced = callback();
				if (produced !== null && typeof produced === 'object' && typeof produced.next === 'function') {
					let step = produced.next();
					while (!step.done) step = produced.next();
					return () => {};
				}
				return produced;
			},
			register: (options, component) => {
				registrations.push({ options, component });
				return () => {};
			},
		},
	};
	module.apply(fakeContext);
	const main = registrations.find((row) => row.options.name === 'main' && row.options.key === 'superman');
	const side = registrations.find((row) => row.options.name === 'sidebar.panellist' && row.options.id === 'superman');
	const props = main.options.inject();
	return { registrations, main, side, props, dictionaries, store: props.hooks.store };
}
//#endregion

//#region fetch stub and fixture
const NOW = Date.now();
const FIXTURE = {
	root: '~/.dsh/superman',
	stats: { total: 4, bytes: 721_216, notes: 1, categories: { pdf: 1, image: 1, code: 1, other: 1 } },
	items: [
		{ id: 'aaaa1111aaaa1111', name: '年度报告.pdf', category: 'pdf', mime: 'application/pdf', bytes: 204_800, addedAt: NOW - 3_600_000, source: 'harness', detail: '12 页 · 200.0 KB', hasText: true, textLength: 1_200, pages: 12 },
		{ id: 'bbbb2222bbbb2222', name: '会议照片.png', category: 'image', mime: 'image/png', bytes: 512_000, addedAt: NOW - 7_200_000, source: 'chat', detail: '1920×1080 · 500.0 KB', hasText: false, textLength: 0, width: 1920, height: 1080 },
		{ id: 'cccc3333cccc3333', name: 'solver.py', category: 'code', mime: 'text/x-python', bytes: 900, addedAt: NOW - 86_400_000, source: 'superman', detail: '900 B', hasText: true, textLength: 30, snippet: 'def solve(n):' },
		{ id: 'dddd4444dddd4444', name: 'archive.zip', category: 'other', mime: 'application/zip', bytes: 4_096, addedAt: NOW - 2 * 86_400_000, source: 'harness', detail: '4.0 KB', hasText: false, textLength: 0 },
	],
	notes: [
		{ id: 'session:abc', kind: 'conversation', title: '重构记忆体索引', text: '我们把索引拆成 items 与 notes 两段。', source: 'harness', createdAt: NOW - 86_400_000, updatedAt: NOW - 3_600_000, tags: ['memory'] },
	],
};
/** Text the Host half returns from `get` for the code item. */
const PREVIEW_TEXT = 'print("hello from solver.py")';

/** The default answers to every action the panel posts. */
function defaultResponder(body) {
	if (body.action === 'list') return { ok: true, value: FIXTURE };
	if (body.action === 'get') {
		const item = FIXTURE.items.find((entry) => entry.id === body.id) ?? FIXTURE.notes.find((entry) => entry.id === body.id);
		return item === undefined
			? { ok: false, error: { code: 'not-found', message: 'no such item' } }
			: { ok: true, value: { item: { ...item, text: PREVIEW_TEXT } } };
	}
	if (body.action === 'delete') return { ok: true, value: { deleted: true } };
	if (body.action === 'store') return { ok: true, value: { item: { id: 'new00000new00000', name: body.name, category: 'other' } } };
	return { ok: false, error: { code: 'bad-request', message: `unknown action: ${body.action}` } };
}

const calls = [];
let responder = defaultResponder;
globalThis.fetch = async (url, init) => {
	const body = JSON.parse(String(init?.body ?? '{}'));
	calls.push({ url: String(url), method: init?.method, body });
	return {
		ok: true,
		status: 200,
		async json() {
			return responder(body);
		},
	};
};

/** The identity translator backed by the Chinese dictionary. */
const t = (key) => (typeof internal.zh[key] === 'string' ? internal.zh[key] : key);

/** Render the registered panel with a snapshot selector Hook. */
function render(booted) {
	const props = {
		...booted.props,
		t,
		useStore: (selector) => selector(booted.store.getSnapshot()),
	};
	return flatten(booted.main.component(props));
}
//#endregion

//#region registration
const first = boot();
check(first.main !== undefined && first.main.options.name === 'main' && first.main.options.key === 'superman', 'a main panel with key superman is registered');
check(first.main?.options.locale === 'superman', 'the main panel is bound to the superman namespace');
check(first.side !== undefined && first.side.options.id === 'superman', 'the sidebar entry id is superman');
check(first.side?.options.order === -5, 'the sidebar entry sits right after Chat mode (order -5)', String(first.side?.options.order));
check(typeof first.side?.options.label === 'function' && first.side.options.label() === 'panel', 'the sidebar label is localized');
check(typeof first.side?.options.locale === 'string' && first.side.options.locale === 'superman', 'the sidebar entry declares the superman locale');
check(first.dictionaries.length === 1 && first.dictionaries[0].ns === 'superman' && first.dictionaries[0].dicts.zh === internal.zh, 'both dictionaries register under the superman namespace');
check(internal.zh.panel === 'Superman' && internal.en.panel === 'Superman', 'the sidebar entry is named Superman in both languages', `${internal.zh.panel}/${internal.en.panel}`);
check(styleTags.length > 0, 'the panel registers its stylesheet');
check(first.props.hooks !== undefined && typeof first.props.hooks.store?.getSnapshot === 'function', 'the panel is injected a store Hook');

const icon = flatten(React.createElement(first.side.component, { size: 18 }));
check(icon.tags.includes('svg') && icon.nodes[0]?.props.width === 18 && icon.nodes[0]?.props.style?.display === 'block', 'the sidebar icon renders a block svg at the requested size', JSON.stringify(icon.tags));
check(icon.tags.filter((tag) => tag === 'path').length >= 3, 'the icon draws a brain', String(icon.tags.filter((tag) => tag === 'path').length));
//#endregion

//#region happy path
await first.props.load();
const loaded = first.store.getSnapshot();
check(loaded.status === 'ready' && loaded.error === null, 'a list reply leaves the panel ready');
check(loaded.items.length === 4 && loaded.notes.length === 1, 'items and records land in the store', `${loaded.items.length}/${loaded.notes.length}`);
check(loaded.root === FIXTURE.root && loaded.stats?.notes === 1, 'the memory root and stats are kept');
check(calls.some((call) => call.method === 'POST' && call.url === '/api/superman/api' && call.body.action === 'list'), 'the mount request posts { action: list }');

const counts = internal.tabCounts(loaded.items, loaded.notes, loaded.stats);
check(counts.all === 5 && counts.pdf === 1 && counts.image === 1 && counts.code === 1 && counts.other === 1 && counts.notes === 1, 'every folder tab gets its count from stats', JSON.stringify(counts));

const panel = render(first);
const text = panel.text.join('\n');
check([internal.zh.tabAll, internal.zh.tabPdf, internal.zh.tabImage, internal.zh.tabCode, internal.zh.tabOther, internal.zh.tabNotes].every((label) => text.includes(label)), 'the rendered panel shows every folder tab', text.slice(0, 120));
check(FIXTURE.items.every((item) => text.includes(item.name)), 'the rendered panel lists every item name');
check(text.includes(FIXTURE.notes[0].title), 'the rendered panel lists the record title');
check(text.includes('def solve(n):'), 'a snippet is shown on the card when the item has one');
check(text.includes(internal.zh.sourceChat) && text.includes(internal.zh.sourceHarness) && text.includes(internal.zh.sourceSuperman), 'source badges are localized', internal.zh.sourceSuperman);
check(text.includes(FIXTURE.root), 'the header shows the memory root path');
check(panel.nodes.some((node) => node.type === 'input' && node.props.type === 'file' && node.props.multiple === true), 'the upload input is a hidden multiple file input');
//#endregion

//#region preview
calls.length = 0;
await first.props.open(FIXTURE.items[2]);
check(calls.some((call) => call.body.action === 'get' && call.body.id === FIXTURE.items[2].id), 'opening a text-bearing item posts { action: get }');
const codePreview = render(first);
check(codePreview.tags.includes('pre') && codePreview.text.join('\n').includes(PREVIEW_TEXT), 'the preview shows the extracted text in a pre block');
check(codePreview.nodes.some((node) => node.type === 'a' && node.props.href === '/api/superman/file?id=' + FIXTURE.items[2].id), 'the preview links to the raw bytes route');

calls.length = 0;
await first.props.open(FIXTURE.items[1]);
const imagePreview = render(first);
check(imagePreview.nodes.some((node) => node.type === 'img' && node.props.src === '/api/superman/file?id=' + FIXTURE.items[1].id), 'an image preview renders the bytes route in an img');
check(!calls.some((call) => call.body.action === 'get'), 'an image preview does not ask for text');

calls.length = 0;
await first.props.open(FIXTURE.notes[0]);
const notePreview = render(first);
check(notePreview.text.join('\n').includes(FIXTURE.notes[0].text), 'a record preview shows its own text');
//#endregion

//#region delete and upload
calls.length = 0;
await first.props.remove(FIXTURE.items[0].id);
check(calls.some((call) => call.url === '/api/superman/api' && call.body.action === 'delete' && call.body.id === FIXTURE.items[0].id), 'deleting a card posts { action: delete, id }');
check(calls.some((call) => call.body.action === 'list'), 'a delete refreshes the list');

calls.length = 0;
const bytes = new TextEncoder().encode('memory note');
const file = { name: 'note.txt', type: 'text/plain', arrayBuffer: async () => bytes.buffer };
await first.props.upload([file]);
const storeCall = calls.find((call) => call.body.action === 'store');
check(storeCall !== undefined && storeCall.body.name === 'note.txt' && storeCall.body.mime === 'text/plain' && storeCall.body.source === 'superman', 'an upload posts { action: store, source: superman }', JSON.stringify(storeCall?.body).slice(0, 120));
check(storeCall !== undefined && Buffer.from(storeCall.body.base64, 'base64').toString('utf8') === 'memory note', 'the uploaded bytes are base64-encoded');

calls.length = 0;
const broken = { name: 'broken.bin', type: 'application/octet-stream', arrayBuffer: async () => { throw new Error('read failed'); } };
const fine = { name: 'ok.txt', type: 'text/plain', arrayBuffer: async () => new Uint8Array([104, 105]).buffer };
await first.props.upload([broken, fine]);
const afterUpload = first.store.getSnapshot();
check(afterUpload.uploads.length === 1 && afterUpload.uploads[0].name === 'broken.bin', 'a failing file becomes one per-file error line', JSON.stringify(afterUpload.uploads));
check(calls.filter((call) => call.body.action === 'store').length === 1, 'the other file is still stored');
const uploadNotice = render(first).text.join('\n');
check(uploadNotice.includes(internal.zh.uploadFailed.replace('{name}', 'broken.bin')), 'the per-file failure line is localized');
//#endregion

//#region failure and empty states
responder = () => ({ ok: false, error: { code: 'bad-request', message: 'index.json is unreadable' } });
const failing = boot();
await failing.props.load();
const failedText = render(failing).text.join('\n');
check(failing.store.getSnapshot().error === 'index.json is unreadable', 'an { ok: false } reply is kept as the error');
check(failedText.includes(internal.zh.errorLoad) && failedText.includes(internal.zh.retry), 'an { ok: false } reply renders the localized error and a retry button');
check(failedText.includes('index.json is unreadable'), 'the server message is shown next to the localized label');

responder = () => { throw new TypeError('network down'); };
const offline = boot();
await offline.props.load();
const offlineText = render(offline).text.join('\n');
check(offlineText.includes(internal.zh.errorLoad), 'a network failure renders the localized error line');

responder = () => ({ ok: true, value: { items: [], notes: [], stats: { total: 0, bytes: 0, notes: 0, categories: { pdf: 0, image: 0, code: 0, other: 0 } }, root: '/tmp/superman' } });
const empty = boot();
await empty.props.load();
const emptyText = render(empty).text.join('\n');
check(emptyText.includes(internal.zh.emptyAll) && emptyText.includes(internal.zh.tabNotes), 'an empty memory renders the empty state and the tabs');

responder = () => ({ ok: true, value: {} });
const sparse = boot();
await sparse.props.load();
const sparseText = render(sparse).text.join('\n');
check(sparseText.includes(internal.zh.rootFallback) && sparseText.includes(internal.zh.emptyAll), 'a payload missing fields still renders without throwing');
check(sparse.store.getSnapshot().items.length === 0 && sparse.store.getSnapshot().notes.length === 0, 'missing lists degrade to empty arrays');
responder = defaultResponder;
//#endregion

// --- the "remembered a file" notices -----------------------------------------
const overlay = first.registrations.find((row) => row.options.name === 'shell.overlay');
check(overlay !== undefined && overlay.options.id === 'superman.toast', 'the notice stack registers in the shell overlay', overlay?.options.id);
const overlayProps = overlay?.options.inject?.();
check(typeof overlayProps?.dismiss === 'function' && typeof overlayProps?.openPanel === 'function', 'the notice stack can be dismissed and can open the panel');

const notifier = module.internal.createNotifier();
const remembered = { id: 'mem-1', name: '论文.pdf', category: 'pdf', detail: '1.2 MB' };
notifier.notify(remembered);
notifier.notify(remembered);
const notices = notifier.store.getSnapshot().toasts;
check(notices.length === 1 && notices[0].item.id === 'mem-1', 'one notice per remembered file, never duplicated', String(notices.length));
const noticeText = textOf(React.createElement(module.internal.ToastStack, {
	...overlayProps,
	t: (key) => key,
	useToasts: (selector) => selector(notifier.store.getSnapshot()),
})).join('\n');
check(noticeText.includes('toastTitle') && noticeText.includes('论文.pdf'), 'the notice names the remembered file', noticeText);
notifier.dismiss(notices[0].id);
check(notifier.store.getSnapshot().toasts.length === 0, 'a notice can be dismissed');

const realFetch = globalThis.fetch;
let memoryItems = [];
globalThis.fetch = async () => ({ json: async () => ({ ok: true, value: { items: memoryItems, notes: [], stats: {}, root: '/tmp/superman' } }) });
const seen = [];
let refreshed = 0;
const watcher = module.internal.createWatcher((item) => seen.push(item.id), () => { refreshed += 1; });
await watcher.poll();
memoryItems = [{ id: 'mem-2', name: '新文件.py', category: 'code', detail: '2 KB' }];
await watcher.poll();
await watcher.poll();
globalThis.fetch = realFetch;
watcher.dispose();
check(seen.length === 1 && seen[0] === 'mem-2', 'the watcher announces only items it had not seen', JSON.stringify(seen));
check(refreshed === 1, 'the watcher asks an open panel to refresh once', String(refreshed));

console.log('');
if (failures.length > 0) {
	console.log(`${failures.length} check(s) failed`);
	for (const failure of failures) console.log(` - ${failure}`);
	process.exit(1);
}
console.log('all checks passed');

/**
 * Smoke test for the arXiv bundle, run outside the browser.
 *
 * Host half: applies the plugin to a stub context, captures the registered
 * route, and drives its handler with a stub `fetch` so every branch of request
 * validation, query building, pacing, and upstream failure is asserted.
 *
 * Client half: materializes the module with a stub module loader and renders
 * the settings section with a stub React. The renderer's real `DOMParser` and
 * `navigator.clipboard` cannot run here, so both are test doubles: the feed
 * mapping, the render path, and the notices are asserted, while the XML parsing
 * itself is exercised only against the canned feed below.
 *
 * Usage: node tools/arxiv-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const PKG_DIR = resolve(import.meta.dirname, '../arxiv-search');
const failures = [];
const check = (condition, label) => {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures.push(label);
		console.log(`  FAIL ${label}`);
	}
};

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>2</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <updated>2023-08-02T00:00:00Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>
      The dominant sequence transduction models are based on complex recurrent networks.
    </summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <arxiv:comment>Accepted at NeurIPS 2017</arxiv:comment>
    <arxiv:journal_ref>Advances in Neural Information Processing Systems 30</arxiv:journal_ref>
    <arxiv:primary_category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2303.08774v6</id>
    <updated>2024-01-05T00:00:00Z</updated>
    <published>2023-03-15T00:00:00Z</published>
    <title>GPT-4 Technical Report</title>
    <summary>We report the development of GPT-4.</summary>
    <author><name>OpenAI</name></author>
    <arxiv:primary_category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <link href="http://arxiv.org/abs/2303.08774v6" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2303.08774v6" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

// ============================================================================
// Host half
// ============================================================================
console.log('host: route registration');
let route;
const host = (await import(pathToFileURL(resolve(PKG_DIR, 'index.js')).href)).apply;
host(
	{
		inject: (names, callback) => {
			callback({
				effect: (factory) => {
					factory();
					return () => {};
				},
				webServer: {
					register: (registered) => {
						route = registered;
						return () => {};
					},
				},
			});
		},
	},
	{ minIntervalMs: 0, requestTimeoutMs: 2000 },
);
check(route?.kind === 'prefix' && route?.path === '/arxiv/search', 'the host registers the /arxiv/search prefix route');

let upstreamCalls = [];
let upstreamHandler = async () => new Response(FEED, { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
	upstreamCalls.push({ url, options });
	return upstreamHandler(url, options);
};
const respond = async (url, method = 'GET') => {
	const captured = { status: undefined, headers: undefined, body: undefined };
	const res = {
		writeHead: (status, headers) => {
			captured.status = status;
			captured.headers = headers;
		},
		end: (body) => {
			captured.body = body;
		},
	};
	await route.handler({ method, url }, res);
	return captured;
};

console.log('host: query building');
let response = await respond('/arxiv/search?mode=author&q=Vaswani&max=5&sort=submitted');
let query = new URL(upstreamCalls[0].url).searchParams;
check(upstreamCalls[0].url.startsWith('https://export.arxiv.org/api/query?'), 'the handler queries the arXiv API');
check(query.get('search_query') === 'au:"Vaswani"', 'author mode builds an au: query');
check(query.get('sortBy') === 'submittedDate' && query.get('sortOrder') === 'descending', 'the submitted sort maps onto arXiv sortBy');
check(query.get('max_results') === '5' && query.get('start') === '0', 'the page size and start are forwarded');
check(response.status === 200 && response.headers['content-type'].startsWith('application/atom+xml'), 'the feed is passed through as Atom');
check(response.body === FEED && response.headers['cache-control'] === 'no-store', 'the body is unmodified and not cached');

upstreamCalls = [];
await respond('/arxiv/search?mode=title&q=Attention%20Is%20All%20You%20Need');
query = new URL(upstreamCalls[0].url).searchParams;
check(query.get('search_query') === 'ti:"Attention Is All You Need"', 'title mode builds a ti: query');
check(query.get('sortBy') === 'relevance', 'the default sort is relevance');

upstreamCalls = [];
await respond('/arxiv/search?mode=category&q=cs.CL');
check(new URL(upstreamCalls[0].url).searchParams.get('search_query') === 'cat:cs.CL', 'category mode builds an unquoted cat: query');

upstreamCalls = [];
await respond('/arxiv/search?mode=id&q=arXiv%3A%202303.08774');
query = new URL(upstreamCalls[0].url).searchParams;
check(query.get('id_list') === '2303.08774', 'id mode strips the arXiv: prefix and whitespace');
check(query.get('sortBy') === null, 'an id lookup sends no sort');

upstreamCalls = [];
await respond('/arxiv/search?q=attention&max=999');
check(new URL(upstreamCalls[0].url).searchParams.get('max_results') === '50', 'the page size is clamped to the endpoint ceiling');
upstreamCalls = [];
await respond('/arxiv/search?q=attention&max=abc');
check(new URL(upstreamCalls[0].url).searchParams.get('max_results') === '20', 'an unreadable page size falls back to 20');

console.log('host: refusals');
response = await respond('/arxiv/search?mode=all&q=');
check(response.status === 400 && JSON.parse(response.body).error.code === 'empty', 'an empty query is refused with 400 empty');
response = await respond(`/arxiv/search?q=${'x'.repeat(301)}`);
check(response.status === 400 && JSON.parse(response.body).error.code === 'too-long', 'an over-long query is refused with 400 too-long');
response = await respond('/arxiv/search?mode=bogus&q=attention');
check(response.status === 400 && JSON.parse(response.body).error.code === 'mode', 'an unknown mode is refused with 400 mode');
response = await respond('/arxiv/search?mode=id&q=Attention');
check(response.status === 400 && JSON.parse(response.body).error.code === 'empty-id', 'an id lookup without digits is refused');
response = await respond('/arxiv/search?q=attention', 'POST');
check(response.status === 405 && JSON.parse(response.body).error.code === 'method', 'a non-GET request is refused with 405');

console.log('host: upstream failures');
upstreamHandler = async () => new Response('nope', { status: 500 });
response = await respond('/arxiv/search?q=attention');
check(response.status === 502 && JSON.parse(response.body).error.code === 'upstream', 'an upstream error becomes 502 upstream with its status');
upstreamHandler = async () => {
	throw new Error('socket hang up');
};
response = await respond('/arxiv/search?q=attention');
check(response.status === 502 && JSON.parse(response.body).error.code === 'network' && JSON.parse(response.body).error.detail === 'socket hang up', 'a transport failure becomes 502 network');

// ============================================================================
// Client half
// ============================================================================
console.log('client: module surface');
const bodyChildren = [];
globalThis.document = {
	head: { appendChild: () => {} },
	body: { appendChild: (node) => bodyChildren.push(node) },
	querySelector: () => null,
	createElement: () => ({
		dataset: {},
		style: {},
		textContent: '',
		select() {},
		remove() {},
	}),
	execCommand: () => true,
};
Object.defineProperty(globalThis, 'navigator', {
	value: { clipboard: { writeText: async () => {} } },
	configurable: true,
});
let stateSlots = [];
let stateIndex = 0;
const fakeReact = {
	createElement(type, props, ...children) {
		const node = { type, props: props ?? {}, children: children.flat() };
		if (typeof type === 'function') return type({ ...(props ?? {}), children: node.children });
		return node;
	},
	useState(initial) {
		const index = stateIndex++;
		const value = stateSlots[index] !== undefined ? stateSlots[index] : typeof initial === 'function' ? initial() : initial;
		return [
			value,
			(next) => {
				stateSlots[index] = typeof next === 'function' ? next(stateSlots[index] !== undefined ? stateSlots[index] : value) : next;
			},
		];
	},
	useEffect(effect) {
		effect();
	},
	useRef() {
		return { current: undefined };
	},
};
let definition;
globalThis.window = {
	__ModuleLoader__: {
		load: (declared) => {
			definition = declared;
		},
	},
};
await import(pathToFileURL(resolve(PKG_DIR, 'client.js')).href);
const exported = definition.factory((name) => {
	if (name === 'react') return fakeReact;
	throw new Error(`unexpected require(${name})`);
});
check(exported.NS === 'arxivSearch' && exported.SECTION_ID === 'arxiv', 'the client declares its namespace and section id');
check(Array.isArray(exported.inject) && exported.inject.includes('slots') && exported.inject.includes('locale'), 'the client injects slots and locale');

let dictionaries;
let registration;
const clientCtx = {
	locale: {
		bind: () => (key) => key,
		register: (ns, value) => {
			dictionaries = { ns, value };
			return () => {};
		},
	},
	effect: (factory) => {
		factory();
		return () => {};
	},
	slots: {
		inject: (name, callback) => {
			callback();
		},
		register: (options, component) => {
			registration = { options, component };
			return () => {};
		},
	},
};
exported.apply(clientCtx);
check(registration?.options.name === 'settings.section', 'the client registers a settings section');
check(registration?.options.id === 'arxiv' && registration?.options.order === 20, 'the section id and order are stable');
check(typeof registration?.options.label === 'function' && registration.options.label() === 'nav', 'the section label resolves through the locale service');
check(dictionaries?.ns === 'arxivSearch', 'the dictionaries register under the plugin namespace');

const zh = dictionaries.value.zh;
const en = dictionaries.value.en;
const dynamicKeys = [
	'modeAll', 'modeTitle', 'modeAuthor', 'modeAbstract', 'modeId', 'modeCategory',
	'placeholderAll', 'placeholderTitle', 'placeholderAuthor', 'placeholderAbstract', 'placeholderId', 'placeholderCategory',
	'sortRelevance', 'sortSubmitted', 'sortUpdated',
	'errEmpty', 'errEmptyId', 'errTooLong', 'errMode', 'errMethod', 'errUpstream', 'errNetwork', 'errParse',
	'favorite', 'favoriteHint', 'favoriting', 'favorited', 'favoritedNote', 'favoriteFailed',
];
const staticKeys = [...readFileSync(resolve(PKG_DIR, 'client.js'), 'utf8').matchAll(/(?<![A-Za-z0-9_$.])t\('([^']+)'\)/g)].map((match) => match[1]);
const usedKeys = new Set([...staticKeys, ...dynamicKeys]);
const missingZh = [...usedKeys].filter((key) => typeof zh[key] !== 'string');
const missingEn = [...usedKeys].filter((key) => typeof en[key] !== 'string');
check(missingZh.length === 0, `every used key exists in zh${missingZh.length ? `: ${missingZh.join(', ')}` : ''}`);
check(missingEn.length === 0, `every used key exists in en${missingEn.length ? `: ${missingEn.join(', ')}` : ''}`);

console.log('client: feed parsing and render');
// Test double for the renderer's XML parser: it understands exactly the canned
// feed shape below, so the mapping and render path run, but not real XML parsing.
globalThis.DOMParser = class {
	parseFromString(source) {
		if (source.includes('<parsererror')) {
			return {
				getElementsByTagName: (tag) => (tag === 'parsererror' ? [{ textContent: 'boom' }] : []),
			};
		}
		// An XML element is either self-closing or paired; arXiv uses both.
		const blocks = (xml, tag) =>
			[...xml.matchAll(new RegExp(`<${tag}\\b[^>]*/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g'))].map((match) => match[0]);
		const inner = (xml, tag) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1];
		const attrs = (xml) => Object.fromEntries([...xml.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
		const element = (xml) => ({
			textContent: xml.replace(/<[^>]+>/g, ' '),
			getAttribute: (name) => attrs(xml)[name] ?? null,
			getElementsByTagName: (tag) => {
				if (tag === 'author') return blocks(xml, 'author').map(element);
				if (tag === 'name') return blocks(xml, 'name').map(element);
				if (tag === 'link') {
					return [...xml.matchAll(/<link\b([^>]*?)\/?>/g)].map((match) => ({
						getAttribute: (name) => attrs(match[1])[name] ?? null,
					}));
				}
				if (tag === 'arxiv:primary_category') return blocks(xml, 'arxiv:primary_category').map(element);
				const found = inner(xml, tag);
				return found === undefined ? [] : [{ textContent: found }];
			},
		});
		return {
			getElementsByTagName: (tag) => {
				if (tag === 'parsererror') return [];
				if (tag === 'entry') return blocks(source, 'entry').map(element);
				const found = inner(source, tag);
				return found === undefined ? [] : [{ textContent: found }];
			},
		};
	}
};

const render = (state, overrides = {}) => {
	stateSlots = state ?? [];
	stateIndex = 0;
	return registration.component({ t: (key) => zh[key] ?? `[${key}]`, ...overrides });
};
const flatten = (node) => {
	if (node === null || node === undefined) return [];
	if (typeof node !== 'object') return [node];
	const children = Array.isArray(node.children) ? node.children : [];
	return [node, ...children.flatMap(flatten)];
};
const textsOf = (node) =>
	flatten(node)
		.flatMap((child) => (typeof child === 'string' || typeof child === 'number' ? [String(child)] : []))
		.join(' | ');
const find = (node, predicate, out = []) => {
	if (node === null || typeof node !== 'object') return out;
	if (predicate(node)) out.push(node);
	for (const child of Array.isArray(node.children) ? node.children : []) find(child, predicate, out);
	return out;
};

const idle = render();
const idleText = textsOf(idle);
check(idleText.includes(zh.title) && idleText.includes(zh.hint), 'the section renders its title and rate-limit hint');
check(find(idle, (node) => node.type === 'form').length === 1, 'the section renders one search form');
check(textsOf(find(idle, (node) => node.type === 'select')[0]).length > 0, 'the mode selector offers localized options');

const emptySubmit = render();
await find(emptySubmit, (node) => node.type === 'form')[0].props.onSubmit({ preventDefault: () => {} });
const emptyState = stateSlots.slice();
check(textsOf(render(emptyState)).includes(zh.errEmpty), 'submitting an empty query explains what is missing');

// A ready answer flows through the Host route and the parser.
let routeCalls = [];
upstreamHandler = async () => new Response(FEED, { status: 200 });
globalThis.fetch = async (url, options) => {
	routeCalls.push({ url, options });
	return upstreamHandler(url, options);
};
const searching = render(['all', 'attention', '20', 'relevance']);
await find(searching, (node) => node.type === 'form')[0].props.onSubmit({ preventDefault: () => {} });
const readyState = stateSlots.slice();
check(routeCalls[0].url.startsWith('arxiv/search?') && routeCalls[0].url.includes('mode=all') && routeCalls[0].url.includes('q=attention'), 'the page calls the same-origin Host route');
const readyText = textsOf(render(readyState));
check(readyText.includes('Attention Is All You Need') && readyText.includes('GPT-4 Technical Report'), 'both parsed papers render');
check(readyText.includes('Ashish Vaswani, Noam Shazeer'), 'the author list renders');
check(readyText.includes('cs.CL'), 'the primary category renders');
check(readyText.includes('Accepted at NeurIPS 2017') && readyText.includes('Advances in Neural Information Processing Systems 30'), 'the venue comment and journal reference render');
check(readyText.includes(`${zh.total} 2`), 'the total result count renders');
const readyPage = render(readyState);
const anchors = find(readyPage, (node) => node.type === 'a').map((node) => node.props.href);
check(anchors.includes('http://arxiv.org/abs/1706.03762v7') && anchors.includes('http://arxiv.org/pdf/1706.03762v7'), 'the abstract page and PDF links render');
check(find(readyPage, (node) => node.type === 'button' && textsOf(node) === zh.copyBibtex).length === 2, 'each paper offers a BibTeX copy action');

// BibTeX copy marks the card it copied.
const copyButtons = find(readyPage, (node) => node.type === 'button' && textsOf(node) === zh.copyBibtex);
await copyButtons[0].props.onClick();
check(textsOf(render(stateSlots.slice())).includes(zh.copied), 'a copied paper reports that the citation was copied');

// Every paper can be archived into the Superman memory.
const memoryCalls = [];
const upstreamForMemory = globalThis.fetch;
globalThis.fetch = async (url, options) => {
	if (String(url).includes('/api/superman/api')) {
		const body = JSON.parse(options.body);
		memoryCalls.push(body);
		if (body.action === 'store') return new Response(JSON.stringify({ ok: true, value: { item: { id: 'mem-1', name: body.name } } }), { status: 200 });
		if (body.action === 'note') return new Response(JSON.stringify({ ok: true, value: { note: body.note } }), { status: 200 });
		return new Response(JSON.stringify({ ok: false, error: { code: 'bad-request', message: 'unknown action' } }), { status: 400 });
	}
	if (String(url).includes('arxiv.org/pdf/')) {
		return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200 });
	}
	return upstreamForMemory(url, options);
};
const archivePage = render(stateSlots.slice());
const archiveButtons = find(archivePage, (node) => node.type === 'button' && textsOf(node) === zh.favorite);
check(archiveButtons.length === 2, 'every paper offers a save-to-memory button', String(archiveButtons.length));

await archiveButtons[0].props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
const storedCall = memoryCalls.find((call) => call.action === 'store');
check(storedCall !== undefined && storedCall.source === 'arxiv' && storedCall.mime === 'application/pdf', 'the button archives the PDF into the memory', JSON.stringify(storedCall?.name));
check(typeof storedCall?.text === 'string' && storedCall.text.includes('Attention Is All You Need') && storedCall.text.includes('arXiv'), 'the archived file carries its metadata for recall');
check(storedCall.base64 === 'JVBERi0=', 'the downloaded bytes are base64 encoded', String(storedCall.base64));
check(textsOf(render(stateSlots.slice())).includes(zh.favorited), 'a successful archive reports that the PDF is stored');

// A blocked download falls back to a record, and a broken memory reports failure.
const noteCall = [];
globalThis.fetch = async (url, options) => {
	if (String(url).includes('/api/superman/api')) {
		const body = JSON.parse(options.body);
		noteCall.push(body);
		if (body.action === 'note') return new Response(JSON.stringify({ ok: true, value: { note: body.note } }), { status: 200 });
		return new Response(JSON.stringify({ ok: false, error: { code: 'bad-request', message: 'unknown action' } }), { status: 400 });
	}
	if (String(url).includes('arxiv.org/pdf/')) return new Response('nope', { status: 403 });
	return upstreamForMemory(url, options);
};
const fallbackButtons = find(render(stateSlots.slice()), (node) => node.type === 'button' && textsOf(node) === zh.favorite);
await fallbackButtons[fallbackButtons.length - 1].props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
const note = noteCall.find((call) => call.action === 'note');
check(note !== undefined && note.note.source === 'arxiv' && note.note.text.includes('GPT-4 Technical Report'), 'a blocked PDF falls back to archiving the record', JSON.stringify(note?.note?.title));
check(textsOf(render(stateSlots.slice())).includes(zh.favoritedNote), 'the fallback is reported as a record');

globalThis.fetch = async (url, options) => {
	if (String(url).includes('/api/superman/api')) return new Response('boom', { status: 500 });
	if (String(url).includes('arxiv.org/pdf/')) return new Response('nope', { status: 403 });
	return upstreamForMemory(url, options);
};
const failedButtons = find(render(stateSlots.slice()), (node) => node.type === 'button' && node.props.title === zh.favoriteHint);
await failedButtons[0].props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
check(textsOf(render(stateSlots.slice())).includes(zh.favoriteFailed), 'an unavailable memory reports the failure instead of pretending');

globalThis.fetch = upstreamForMemory;

// Failures keep their own wording.
upstreamHandler = async () => new Response(JSON.stringify({ error: { code: 'upstream', detail: '503' } }), { status: 502 });
const failing = render(['all', 'attention']);
await find(failing, (node) => node.type === 'form')[0].props.onSubmit({ preventDefault: () => {} });
const failedState = stateSlots.slice();
check(textsOf(render(failedState)).includes(`${zh.errUpstream}: 503`), 'an upstream failure renders its own notice with the detail');

upstreamHandler = async () => new Response('<parsererror>boom</parsererror>', { status: 200 });
const unparsable = render(['all', 'attention']);
await find(unparsable, (node) => node.type === 'form')[0].props.onSubmit({ preventDefault: () => {} });
check(textsOf(render(stateSlots.slice())).includes(zh.errParse), 'an unparsable body renders the parse notice');

globalThis.fetch = realFetch;
console.log(failures.length === 0 ? '\nPASS' : `\nFAIL (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);

/**
 * Smoke test for the plugin-market client half, run outside the browser: it
 * materializes the module with a stub module loader, applies it to a stub
 * plugin context, and renders the panel with a stub React so the render path
 * executes against several Host states.
 *
 * Usage: node tools/plugin-market-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const PKG_DIR = resolve(import.meta.dirname, '../plugin-market');
const failures = [];
const check = (condition, label) => {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures.push(label);
		console.log(`  FAIL ${label}`);
	}
};

// ---- stub React -------------------------------------------------------------
const tree = [];
let stateSlots = [];
let stateIndex = 0;
const fakeReact = {
	createElement(type, props, ...children) {
		const node = { type, props: props ?? {}, children: children.flat() };
		// Function components are invoked so the whole tree materializes as host nodes.
		if (typeof type === 'function') return type({ ...(props ?? {}), children: node.children });
		return node;
	},
	useState(initial) {
		const index = stateIndex++;
		const value = stateSlots[index] !== undefined ? stateSlots[index] : typeof initial === 'function' ? initial() : initial;
		return [value, (next) => {
			stateSlots[index] = next;
		}];
	},
	useEffect(effect) {
		effect();
	},
};

// ---- stub document ----------------------------------------------------------
const headChildren = [];
globalThis.document = {
	head: {
		appendChild: (node) => headChildren.push(node),
	},
	querySelector: () => null,
	createElement: () => ({
		dataset: {},
		textContent: '',
		remove() {},
	}),
};

// ---- stub module loader -----------------------------------------------------
let definition;
globalThis.window = {
	__ModuleLoader__: {
		load(declared) {
			definition = declared;
		},
	},
};
await import(pathToFileURL(resolve(PKG_DIR, 'client.js')).href);
if (definition === undefined) {
	console.error('the client module registered no factory');
	process.exit(1);
}
const exports_ = definition.factory((name) => {
	if (name === 'react') return fakeReact;
	throw new Error(`unexpected require(${name})`);
});

// ---- stub ctx ---------------------------------------------------------------
let dictionaries;
const registrations = [];
const fakeCtx = {
	locale: {
		bind: () => (key) => `[${key}]`,
		register: (ns, value) => {
			dictionaries = { ns, value };
			return () => {};
		},
		getSnapshot: () => ({ revision: 0 }),
	},
	effect: (factory) => {
		const disposer = factory();
		return typeof disposer === 'function' ? disposer : () => {};
	},
	remote: {
		$on: () => () => {},
		pluginManager: {
			listBundles: async () => ({ ok: true, value: [] }),
			installBundle: async () => ({ ok: true, value: { changed: true, application: 'applied', stage: 'install', target: 'x' } }),
			setBundleEnabled: async () => ({ ok: true, value: { changed: true, application: 'applied', stage: 'enable', target: 'x' } }),
		},
		pluginInventory: { list: async () => ({ ok: true, value: { managementAvailable: true } }) },
	},
	slots: {
		inject: (name, callback) => {
			if (typeof callback !== 'function') return;
			const result = callback();
			if (result !== undefined && typeof result.next === 'function') {
				let step = result.next();
				while (!step.done) step = result.next();
			}
		},
		register: (options, component) => {
			registrations.push({ options, component });
			return () => {};
		},
	},
};

console.log('module surface');
check(exports_.NS === 'pluginMarket', 'NS is stable');
check(exports_.PANEL_ID === 'plugin-market', 'PANEL_ID is stable');
check(Array.isArray(exports_.inject) && exports_.inject.includes('slots') && exports_.inject.includes('remote.pluginManager'), 'inject lists the required services');
check(typeof exports_.apply === 'function', 'apply is exported');

console.log('apply');
exports_.apply(fakeCtx);
const page = registrations.find((entry) => entry.options.name === 'main');
const entry = registrations.find((entry) => entry.options.name === 'sidebar.panellist');
check(page?.options.key === 'plugin-market', 'main registers under the sidebar id');
check(entry?.options.id === 'plugin-market', 'sidebar.panellist registers the entry id');
check(typeof entry?.options.label === 'function' && entry.options.label() === '[panel]', 'sidebar label resolves through the locale service');
check(dictionaries?.ns === 'pluginMarket', 'dictionaries register under the plugin namespace');

// ---- dictionary coverage ----------------------------------------------------
const source = readFileSync(resolve(PKG_DIR, 'client.js'), 'utf8');
const dynamicKeys = [
	'installing', 'applied', 'unchanged', 'restartRequired', 'overridden', 'cancelled', 'failed', 'notBundle', 'needsBuilds',
	'tagOfficial', 'tagExperimental', 'tagCommunity',
];
const staticKeys = [...source.matchAll(/(?<![A-Za-z0-9_$.])t\('([^']+)'\)/g)].map((match) => match[1]);
const usedKeys = new Set([...staticKeys, ...dynamicKeys]);
const zh = dictionaries.value.zh;
const en = dictionaries.value.en;
const missingZh = [...usedKeys].filter((key) => typeof zh[key] !== 'string');
const missingEn = [...usedKeys].filter((key) => typeof en[key] !== 'string');
check(missingZh.length === 0, `every used key exists in zh${missingZh.length ? `: ${missingZh.join(', ')}` : ''}`);
check(missingEn.length === 0, `every used key exists in en${missingEn.length ? `: ${missingEn.join(', ')}` : ''}`);
const zhTitles = Object.keys(zh).filter((key) => key.startsWith('catTitle'));
const missingSummaries = zhTitles.filter((key) => typeof zh[`catSummary${key.slice(8)}`] !== 'string');
check(zhTitles.length >= 16 && missingSummaries.length === 0, `catalog text pairs are complete (${zhTitles.length} entries)`);
check(zhTitles.every((key) => typeof en[key] === 'string'), 'catalog titles exist in en too');
check(!/tagOfficialLabel/.test(source), 'no stray dictionary key');

// ---- render -----------------------------------------------------------------
const render = (bundles, status, state) => {
	stateSlots = state ?? [];
	stateIndex = 0;
	const resolve = (key) => zh[key] ?? `[${key}]`;
	const props = {
		t: resolve,
		useMarket: (selector) => selector({ status, bundles, jobs: {} }),
		load: () => {},
		install: () => {},
		setEnabled: () => {},
		clearJob: () => {},
		...page.options.inject(),
	};
	props.t = resolve;
	props.useMarket = (selector) => selector({ status, bundles, jobs: {} });
	return page.component(props);
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

console.log('render states');
const sampleBundles = [
	{ name: '@deepseek-ai/dsh-experimental-schedule-bundle', version: '0.2.0-rc.2', enabled: false, installed: false, optional: true, meta: { title: '自动化任务', description: '按设定时间执行' } },
	{ name: 'dsh-knowledge', version: '0.5.2', enabled: true, installed: true, optional: false, meta: { title: { zh: '知识库', en: 'Knowledge base' } } },
	{ name: '@deepseek-ai/dsh-experimental-elsewhere-bundle', version: '0.1.0', enabled: false, installed: false, optional: true, meta: { title: '不在目录里的官方包' } },
	{ name: 'some-profile-plugin', version: '1.2.3', enabled: true, installed: true, optional: false, removable: true, description: '已安装的第三方插件' },
	{ name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true, installed: true, optional: false },
];
const ready = render(sampleBundles, 'ready');
const readyText = textsOf(ready);
check(ready.props['data-plugin-market'] === true, 'the panel renders its root section');
check(readyText.includes(zh.groupCatalog) && readyText.includes(zh.groupOfficial) && readyText.includes(zh.groupInstalled), 'catalog, official and installed groups render');
check(readyText.includes('不在目录里的官方包') && readyText.includes('已安装的第三方插件'), 'bundles outside the catalog render in their own groups');
check(readyText.includes('@deepseek-ai/dsh-experimental-schedule-bundle'), 'official bundle card renders');
check(!readyText.includes('@deepseek-ai/dsh-base'), 'built-in profile bundles stay out of the list');
check(textsOf(render(sampleBundles, 'unavailable')).includes(zh.unavailable), 'an unmanaged Host renders the unavailable state');
check(textsOf(render([], 'error')).includes(zh.retry), 'a read failure renders the retry state');
const named = render([], 'ready', ['catalog', 'dsh-unknown-plugin']);
check(textsOf(named).includes(zh.groupNamed) && textsOf(named).includes('dsh-unknown-plugin'), 'a typed package name offers an install card');
const filtered = render([], 'ready', ['catalog', '知识']);
check(textsOf(filtered).includes(zh.catTitleKnowledge) && !textsOf(filtered).includes(zh.catTitleSaveToken), 'search filters the catalog by localized text');
const noMatch = render([], 'ready', ['catalog', 'zzz not a plugin']);
check(textsOf(noMatch).includes(zh.empty), 'an unmatched search reports emptiness');

// ---- operations -------------------------------------------------------------
console.log('operations');
let installedSpec;
let installOptions;
const installCtx = {
	...fakeCtx,
	remote: {
		...fakeCtx.remote,
		pluginManager: {
			listBundles: async () => ({ ok: true, value: [] }),
			installBundle: async (spec, options) => {
				installedSpec = spec;
				installOptions = options;
				return { ok: true, value: { changed: true, application: 'restart-required', stage: 'install', target: spec, pendingBuilds: ['esbuild'] } };
			},
			setBundleEnabled: async () => ({ ok: true, value: { changed: true, application: 'applied', stage: 'enable', target: 'x' } }),
		},
	},
};
const operations = (() => {
	let captured;
	const ctx = {
		...installCtx,
		slots: {
			...installCtx.slots,
			register: (options, component) => {
				if (options.name === 'main') captured = { options, component };
				return () => {};
			},
		},
	};
	exports_.apply(ctx);
	return captured;
})();
const opProps = {
	t: (key) => zh[key] ?? `[${key}]`,
	...operations.options.inject(),
};
await opProps.install('catalog:x', '@deepseek-ai/dsh-experimental-schedule-bundle');
check(installedSpec === '@deepseek-ai/dsh-experimental-schedule-bundle', 'install hands the Host the catalog spec');
check(installOptions?.enabled === true && typeof installOptions?.requestId === 'string', 'install requests an enabled bundle with a request id');
const snapshot = opProps.hooks.market.getSnapshot();
check(snapshot.jobs['catalog:x']?.code === 'needsBuilds', 'a pending build script is reported on the card');
check(snapshot.jobs['catalog:x']?.builds?.[0] === 'esbuild', 'the pending build name is kept for the retry');
await opProps.install('catalog:x', '@deepseek-ai/dsh-experimental-schedule-bundle', ['esbuild']);
check(installOptions?.approvedBuilds?.[0] === 'esbuild', 'allowing builds passes approvedBuilds');
const before = snapshot.jobs['catalog:x'];
opProps.clearJob('catalog:x');
check(opProps.hooks.market.getSnapshot().jobs['catalog:x'] === undefined, 'clearJob drops the notice');
check(before !== undefined, 'the notice existed before clearing');

// ---- github search ----------------------------------------------------------
console.log('github search');
const storage = new Map();
globalThis.localStorage = {
	getItem: (key) => (storage.has(key) ? storage.get(key) : null),
	setItem: (key, value) => storage.set(key, String(value)),
	removeItem: (key) => storage.delete(key),
};
let fetchCalls = [];
let fetchHandler = async () =>
	new Response(JSON.stringify({ total_count: 0, items: [] }), {
		status: 200,
		headers: { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '10' },
	});
globalThis.fetch = async (url, options) => {
	fetchCalls.push({ url, options });
	return fetchHandler(url, options);
};
const githubMarket = (() => {
	let captured;
	exports_.apply({
		...fakeCtx,
		slots: {
			...fakeCtx.slots,
			register: (options, component) => {
				if (options.name === 'main') captured = { options, component };
				return () => {};
			},
		},
	});
	return captured.options.inject();
})();
check(
	typeof githubMarket.searchGithub === 'function' && typeof githubMarket.readToken === 'function' && typeof githubMarket.writeToken === 'function',
	'the registration exposes the GitHub actions',
);
githubMarket.writeToken('ghp_test');
check(githubMarket.readToken() === 'ghp_test', 'the token round-trips through storage');
githubMarket.writeToken('');
check(githubMarket.readToken() === '', 'clearing the token forgets it');

fetchCalls = [];
fetchHandler = async () =>
	new Response(
		JSON.stringify({
			total_count: 18614,
			items: [
				{
					full_name: 'deepseek-ai/deepseek-harness',
					html_url: 'https://github.com/deepseek-ai/deepseek-harness',
					description: 'Everything is a Plugin.',
					stargazers_count: 246926,
					language: 'TypeScript',
					updated_at: '2026-10-09T12:00:00Z',
				},
			],
		}),
		{ status: 200, headers: { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '7', 'x-ratelimit-reset': '1791657619' } },
	);
await githubMarket.searchGithub('topic:dsh-plugin', 'stars');
const searched = githubMarket.hooks.market.getSnapshot().github;
check(searched.status === 'ready' && searched.items.length === 1 && searched.total === 18614, 'a search stores its repositories and total');
check(
	searched.items[0].fullName === 'deepseek-ai/deepseek-harness' && searched.items[0].stars === 246926 && searched.items[0].updated === '2026-10-09',
	'each repository is projected onto the card fields',
);
check(searched.rate?.remaining === 7 && searched.rate?.limit === 10, 'the rate-limit headers become part of the snapshot');
const searchCall = fetchCalls[0];
check(
	searchCall.url.startsWith('https://api.github.com/search/repositories?q=topic%3Adsh-plugin') &&
		searchCall.url.includes('sort=stars') &&
		searchCall.url.includes('per_page=30'),
	'the request carries the query, the sort and the page size',
);
check(searchCall.options.headers.Authorization === undefined, 'an unauthenticated search sends no Authorization header');

githubMarket.writeToken('ghp_test');
fetchCalls = [];
fetchHandler = async () =>
	new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200, headers: { 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '29' } });
await githubMarket.searchGithub('dsh-plugin in:name,description', '');
check(fetchCalls[0].options.headers.Authorization === 'Bearer ghp_test', 'a saved token is sent as a bearer credential');
check(!fetchCalls[0].url.includes('sort='), 'best match omits the sort parameter');
githubMarket.writeToken('');

fetchHandler = async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 });
await githubMarket.searchGithub('topic:dsh-plugin', 'stars');
const limited = githubMarket.hooks.market.getSnapshot().github;
check(
	limited.status === 'error' && limited.code === 'ghRateLimited' && limited.detail === 'API rate limit exceeded',
	'a 403 becomes the rate-limit notice carrying the API message',
);

fetchHandler = async () => {
	throw new Error('offline');
};
await githubMarket.searchGithub('topic:dsh-plugin', 'stars');
const failedSearch = githubMarket.hooks.market.getSnapshot().github;
check(failedSearch.status === 'error' && failedSearch.code === 'ghFailed' && failedSearch.detail === 'offline', 'a transport failure becomes the search-failure notice');

// ---- github render ----------------------------------------------------------
console.log('github render');
const renderPage = ({ github, status, bundles, state, onSearch, onInstall }) => {
	stateSlots = state ?? [];
	stateIndex = 0;
	const resolve = (key) => zh[key] ?? `[${key}]`;
	return page.component({
		t: resolve,
		useMarket: (selector) => selector({ status: status ?? 'ready', bundles: bundles ?? [], jobs: {}, github }),
		load: () => {},
		install: onInstall ?? (() => {}),
		setEnabled: () => {},
		clearJob: () => {},
		searchGithub: onSearch ?? (() => {}),
		readToken: () => '',
		writeToken: () => {},
	});
};
const findButtons = (node, out = []) => {
	if (node === null || typeof node !== 'object') return out;
	if (node.type === 'button') out.push(node);
	const children = Array.isArray(node.children) ? node.children : [];
	for (const child of children) findButtons(child, out);
	return out;
};
const labelOf = (node) =>
	flatten(node)
		.filter((child) => typeof child === 'string')
		.join('');
const catalogPage = renderPage({ github: { status: 'idle', items: [] } });
const githubTab = findButtons(catalogPage).find((button) => labelOf(button) === zh.tabGithub);
check(githubTab !== undefined, 'the panel offers the GitHub tab');
githubTab.props.onClick();
const openedState = stateSlots.slice();
const searches = [];
const idlePage = renderPage({
	github: { status: 'idle', items: [] },
	state: openedState,
	onSearch: (query, sort) => searches.push({ query, sort }),
});
check(
	searches.length === 1 && searches[0].query === 'topic:dsh-plugin' && searches[0].sort === 'stars',
	'opening the GitHub tab runs the default search once',
);
const idleText = textsOf(idlePage);
check(idleText.includes(zh.ghIntro) && idleText.includes(zh.ghSearch) && idleText.includes(zh.ghTrust), 'the GitHub view renders its controls and trust note');

const readyGithub = {
	status: 'ready',
	total: 42,
	rate: { limit: 10, remaining: 9, reset: 1791657619 },
	items: [
		{
			fullName: 'acme/dsh-widget',
			url: 'https://github.com/acme/dsh-widget',
			description: 'A widget plugin',
			stars: 5,
			language: 'Go',
			updated: '2026-01-02',
		},
	],
};
const installs = [];
const readyPage = renderPage({
	github: readyGithub,
	state: openedState,
	onInstall: (key, spec, builds) => installs.push({ key, spec, builds }),
});
const repoText = textsOf(readyPage);
check(repoText.includes('acme/dsh-widget'), 'a result card renders its repository name');
check(repoText.includes('github:acme/dsh-widget'), 'a result card shows the git address it installs');
check(repoText.includes('★ 5'), 'a result card shows the star count');
check(repoText.includes(`${zh.ghResults} 42`), 'the result summary reports the total match count');
check(repoText.includes(`${zh.ghQuotaLabel} 9/10`), 'the quota line reports the remaining searches');
const repoLinks = flatten(readyPage).filter((node) => node.type === 'a');
check(
	repoLinks.length === 1 && repoLinks[0].props.href === 'https://github.com/acme/dsh-widget' && repoLinks[0].props.target === '_blank',
	'the repository name links out to GitHub in a new tab',
);
const installButton = findButtons(readyPage).find((button) => labelOf(button) === zh.install);
check(installButton !== undefined, 'a result card offers an install action');
installButton.props.onClick();
check(installs[0]?.key === 'gh:acme/dsh-widget' && installs[0]?.spec === 'github:acme/dsh-widget', 'the install action hands the Host the git address');

const ratePage = renderPage({ github: { status: 'error', code: 'ghRateLimited', detail: 'API rate limit exceeded', items: [] }, state: openedState });
check(textsOf(ratePage).includes(zh.ghRateLimited) && textsOf(ratePage).includes(zh.retry), 'a rate-limited search renders its notice and a retry');

console.log(failures.length === 0 ? '\nPASS' : `\nFAIL (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);

/**
 * Smoke test for the theme-market bundle, run outside the browser.
 *
 * The bundle is browser-only, so the test materializes it with a stub module
 * loader and drives its controller and section with stub services: a stub
 * `ctx.theme` records the token layers and preference writes, and a stub
 * `fetch` answers the GitHub and npm searches. A stub React renders the section
 * so the panel's own paths (tabs, preset cards, custom composer, marketplace
 * results) execute.
 *
 * Usage: node tools/theme-market-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const PKG_DIR = resolve(import.meta.dirname, '../theme-market');
const failures = [];
const check = (condition, label) => {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures.push(label);
		console.log(`  FAIL ${label}`);
	}
};

// ---- stubs ------------------------------------------------------------------
const storage = new Map();
globalThis.localStorage = {
	getItem: (key) => (storage.has(key) ? storage.get(key) : null),
	setItem: (key, value) => storage.set(key, String(value)),
	removeItem: (key) => storage.delete(key),
};
const headChildren = [];
const headStyles = new Map();
globalThis.document = {
	head: {
		appendChild: (node) => {
			headChildren.push(node);
			if (typeof node.dataset?.pluginCss === 'string') headStyles.set(node.dataset.pluginCss, node);
		},
	},
	querySelector: (selector) => {
		const match = /data-plugin-css="([^"]+)"/.exec(selector);
		return match === null ? null : headStyles.get(match[1]) ?? null;
	},
	createElement: () => {
		const node = {
			dataset: {},
			textContent: '',
			style: {},
			remove() {
				if (typeof node.dataset.pluginCss === 'string') headStyles.delete(node.dataset.pluginCss);
			},
		};
		return node;
	},
	body: { hasAttribute: () => false },
	documentElement: { hasAttribute: () => false },
};
let measuredSurface = '';
globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => (name === '--dsw-alias-bg-layer-2' ? measuredSurface : '') });
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
				stateSlots[index] = next;
			},
		];
	},
	useEffect(effect) {
		effect();
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

// ---- stub services ----------------------------------------------------------
const themeListeners = new Set();
const themeCalls = { setTheme: [], setFontSize: [], layers: [] };
let liveTheme = { preference: 'system', fontSize: 14, active: { colorScheme: 'light' } };
let currentLayer;
const themeService = {
	getTheme: () => liveTheme,
	setTheme: (id) => {
		themeCalls.setTheme.push(id);
		liveTheme = { ...liveTheme, preference: id };
	},
	setFontSize: (px) => {
		themeCalls.setFontSize.push(px);
		liveTheme = { ...liveTheme, fontSize: px };
	},
	overrideTokens: (source, tokens) => {
		themeCalls.layers.push({ source, tokens });
		const layer = { source, tokens };
		currentLayer = layer;
		return () => {
			if (currentLayer === layer) currentLayer = undefined;
		};
	},
};
const installCalls = [];
const enableCalls = [];
let bundleList = [];
let installAnswer = {
	ok: true,
	value: { changed: true, application: 'restart-required', stage: 'install', target: 'x', bundle: 'dsh-bloom-theme', pendingBuilds: ['esbuild'] },
};
let enableAnswer = { ok: true, value: { changed: true, application: 'applied', stage: 'enable', target: 'x' } };
const pluginManager = {
	installBundle: async (spec, options) => {
		installCalls.push({ spec, options });
		return installAnswer;
	},
	listBundles: async () => ({ ok: true, value: bundleList }),
	setBundleEnabled: async (name, enabled) => {
		enableCalls.push({ name, enabled });
		return enableAnswer;
	},
};
let dictionaries;
let registration;
const remoteEvents = new Map();
const makeCtx = (capture) => ({
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
	theme: themeService,
	on: (event, handler) => {
		if (event === 'theme/change') themeListeners.add(handler);
		return () => themeListeners.delete(handler);
	},
	remote: {
		pluginManager,
		$on: (event, handler) => {
			remoteEvents.set(event, handler);
			return () => remoteEvents.delete(event);
		},
	},
	slots: {
		inject: (name, callback) => {
			callback();
		},
		register: (options, component) => {
			if (capture === undefined || options.name === capture) registration = { options, component };
			return () => {};
		},
	},
});

console.log('module surface');
check(exported.NS === 'themeMarket' && exported.SECTION_ID === 'theme-market', 'the module declares its namespace and section id');
check(exported.LAYER_SOURCE === exported.PKG, 'the override layer is named after the package');
check(
	Array.isArray(exported.inject) && exported.inject.includes('theme') && exported.inject.includes('remote.pluginManager'),
	'the module injects the theme service and the plugin manager remote',
);

console.log('registration');
storage.clear();
exported.apply(makeCtx('settings.section'));
check(registration?.options.name === 'settings.section', 'the module registers a settings section');
check(registration?.options.id === 'theme-market' && registration?.options.order === 21, 'the section id and order are stable');
check(typeof registration?.options.label === 'function' && registration.options.label() === 'nav', 'the section label resolves through the locale service');
check(dictionaries?.ns === 'themeMarket', 'the dictionaries register under the plugin namespace');

const zh = dictionaries.value.zh;
const en = dictionaries.value.en;
const dynamicKeys = [
	...['default', 'ocean', 'forest', 'amber', 'violet', 'rose', 'mono', 'soft'].flatMap((key) => [
		`preset${key[0].toUpperCase()}${key.slice(1)}Name`,
		`preset${key[0].toUpperCase()}${key.slice(1)}Desc`,
	]),
	'strengthSoft', 'strengthStandard', 'strengthStrong',
	'schemeSystem', 'schemeLight', 'schemeDark',
	'activeDefault', 'activeCustom',
	'applied', 'unchanged', 'restartRequired', 'overridden', 'cancelled', 'failed', 'notBundle', 'needsBuilds',
	'rateLimited', 'searchFailed',
	'rpcMissing', 'downloadFailed', 'cancelling',
];
const staticKeys = [...readFileSync(resolve(PKG_DIR, 'client.js'), 'utf8').matchAll(/(?<![A-Za-z0-9_$.])t\('([^']+)'\)/g)].map((match) => match[1]);
const usedKeys = new Set([...staticKeys, ...dynamicKeys]);
const missingZh = [...usedKeys].filter((key) => typeof zh[key] !== 'string');
const missingEn = [...usedKeys].filter((key) => typeof en[key] !== 'string');
check(missingZh.length === 0, `every used key exists in zh${missingZh.length ? `: ${missingZh.join(', ')}` : ''}`);
check(missingEn.length === 0, `every used key exists in en${missingEn.length ? `: ${missingEn.join(', ')}` : ''}`);

// ---- controller -------------------------------------------------------------
console.log('theme layers');
storage.clear();
themeCalls.layers = [];
const market = registration.options.inject();
const snapshotOf = () => market.hooks.themeMarket.getSnapshot();
check(themeCalls.layers.length === 0, 'nothing is layered before a scheme is chosen');
market.applyScheme({ kind: 'preset', key: 'ocean' });
const oceanLayer = themeCalls.layers.at(-1);
check(oceanLayer?.source === exported.LAYER_SOURCE, 'applying a scheme stacks one layer under the package name');
check(
	oceanLayer.tokens['--dsw-alias-brand-primary'].light === '#2F6BFF' && oceanLayer.tokens['--dsw-alias-brand-primary'].dark === '#7C9BFF',
	'the accent pair reaches the layer per color scheme',
);
check(oceanLayer.tokens['--dsw-radius-lg'].light === '12px' && oceanLayer.tokens['--dsw-radius-lg'].dark === '12px', 'the radius scale reaches the layer');
check(snapshotOf().selection?.key === 'ocean' && snapshotOf().preview === null, 'the applied scheme becomes the selection');
check(JSON.parse(storage.get('dsh.themeMarket.selection')).key === 'ocean', 'the applied scheme is remembered for the next load');

market.previewScheme({ kind: 'preset', key: 'forest' });
const forestLayer = themeCalls.layers.at(-1);
check(forestLayer.tokens['--dsw-alias-brand-primary'].light === '#1F8A5F', 'a preview restacks the layer with the candidate tokens');
check(JSON.parse(storage.get('dsh.themeMarket.selection')).key === 'ocean', 'a preview leaves the remembered selection alone');
check(snapshotOf().preview?.key === 'forest', 'the preview is visible in the snapshot');
market.cancelPreview();
check(themeCalls.layers.at(-1).tokens['--dsw-alias-brand-primary'].light === '#2F6BFF', 'cancelling a preview restores the applied scheme');
check(snapshotOf().preview === null, 'the preview flag clears');

market.applyScheme({ kind: 'custom', accent: '#123456', radius: 0, strength: 'strong' });
const customLayer = themeCalls.layers.at(-1);
check(customLayer.tokens['--dsw-alias-brand-primary'].light === '#123456', 'a custom scheme uses the picked accent');
check(customLayer.tokens['--dsw-radius-lg'].light === '0px', 'a custom scheme uses the picked radius');
check(
	customLayer.tokens['--dsw-alias-interactive-bg-hover-accent'].light.includes('24%'),
	'the emphasis level drives how far the accent tints soft surfaces',
);
check(snapshotOf().selection?.kind === 'custom', 'the custom scheme becomes the selection');

market.resetTheme();
check(snapshotOf().selection === null && snapshotOf().preview === null, 'resetting clears the selection');
check(storage.has('dsh.themeMarket.selection') === false, 'resetting forgets the remembered scheme');
check(currentLayer === undefined, 'resetting removes the override layer');

console.log('preference and adoption');
market.setColorScheme('dark');
check(themeCalls.setTheme.at(-1) === 'dark', 'the color scheme switches through setTheme');
market.setFontSize(16);
check(themeCalls.setFontSize.at(-1) === 16, 'the font size switches through setFontSize');
liveTheme = { preference: 'light', fontSize: 18, active: { colorScheme: 'light' } };
for (const listener of themeListeners) listener();
check(snapshotOf().preference === 'light' && snapshotOf().fontSize === 18, 'an outside theme change is adopted into the panel snapshot');

console.log('restore on load');
storage.set('dsh.themeMarket.selection', JSON.stringify({ kind: 'preset', key: 'violet' }));
storage.delete('dsh.themeMarket.token');
themeCalls.layers = [];
exported.apply(makeCtx('settings.section'));
check(themeCalls.layers.length === 1, 'a remembered scheme is layered as the plugin loads');
check(themeCalls.layers[0].tokens['--dsw-alias-brand-primary'].light === '#7C4DFF', 'the remembered scheme\'s tokens are the ones restored');
storage.clear();

// ---- marketplace search -----------------------------------------------------
console.log('marketplace search');
let fetchCalls = [];
let fetchHandler = async () => new Response('{}', { status: 200 });
globalThis.fetch = async (url, options) => {
	fetchCalls.push({ url, options });
	return fetchHandler(url, options);
};
const marketApi = (() => {
	exported.apply(makeCtx('settings.section'));
	return registration.options.inject();
})();
const apiSnapshot = () => marketApi.hooks.themeMarket.getSnapshot();

fetchCalls = [];
fetchHandler = async () =>
	new Response(
		JSON.stringify({
			total_count: 35,
			items: [
				{
					full_name: 'Nwflower/dsh-claude-style',
					html_url: 'https://github.com/Nwflower/dsh-claude-style',
					description: 'Claude Code Desktop theme for DeepSeek Harness',
					stargazers_count: 148,
					language: 'TypeScript',
					updated_at: '2026-10-09T12:00:00Z',
				},
			],
		}),
		{ status: 200, headers: { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '6', 'x-ratelimit-reset': '1791657619' } },
	);
await marketApi.searchMarket('github', 'topic:dsh-theme', 'stars');
let marketState = apiSnapshot().market;
check(marketState.status === 'ready' && marketState.items.length === 1 && marketState.total === 35, 'a GitHub search stores its repositories and total');
check(
	marketState.items[0].key === 'gh:Nwflower/dsh-claude-style' && marketState.items[0].spec === 'github:Nwflower/dsh-claude-style',
	'a GitHub hit carries its git install spec',
);
check(marketState.items[0].stars === 148 && marketState.items[0].updated === '2026-10-09', 'a GitHub hit carries its stars and update date');
check(marketState.rate?.remaining === 6, 'the GitHub quota becomes part of the snapshot');
check(
	fetchCalls[0].url.includes('api.github.com/search/repositories') &&
		fetchCalls[0].url.includes('q=topic%3Adsh-theme') &&
		fetchCalls[0].url.includes('sort=stars') &&
		fetchCalls[0].url.includes('per_page=20'),
	'the GitHub request carries the query, the sort and the page size',
);
check(fetchCalls[0].options.headers.Authorization === undefined, 'an unauthenticated search sends no Authorization header');

marketApi.storeToken('ghp_test');
fetchCalls = [];
marketApi.searchMarket('github', 'topic:dsh-ui', '');
check(fetchCalls[0].options.headers.Authorization === 'Bearer ghp_test', 'a saved token is sent as a bearer credential');
check(!fetchCalls[0].url.includes('sort='), 'best match omits the sort parameter');
marketApi.storeToken('');

fetchCalls = [];
fetchHandler = async () =>
	new Response(
		JSON.stringify({
			total: 8,
			objects: [
				{
					package: {
						name: 'dsh-bloom-theme',
						version: '0.17.6',
						description: 'Bloom for DSH',
						date: '2026-10-02T00:00:00.000Z',
						links: { npm: 'https://www.npmjs.com/package/dsh-bloom-theme' },
					},
				},
			],
		}),
		{ status: 200 },
	);
await marketApi.searchMarket('npm', 'keywords:dsh-theme', 'stars');
marketState = apiSnapshot().market;
check(marketState.items[0].key === 'npm:dsh-bloom-theme' && marketState.items[0].spec === 'dsh-bloom-theme', 'an npm hit installs by package name');
check(marketState.items[0].version === '0.17.6' && marketState.items[0].updated === '2026-10-02', 'an npm hit carries its version and date');
check(
	fetchCalls[0].url.startsWith('https://registry.npmjs.org/-/v1/search?text=keywords%3Adsh-theme') && fetchCalls[0].url.includes('size=20'),
	'the npm request carries the text and page size',
);

fetchHandler = async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 });
await marketApi.searchMarket('github', 'topic:dsh-theme', 'stars');
check(
	apiSnapshot().market.code === 'rateLimited' && apiSnapshot().market.detail === 'API rate limit exceeded',
	'a 403 becomes the GitHub rate-limit notice with the API message',
);
fetchHandler = async () => new Response('boom', { status: 500 });
await marketApi.searchMarket('npm', 'keywords:dsh-theme', 'stars');
check(apiSnapshot().market.code === 'searchFailed' && apiSnapshot().market.source === 'npm', 'an npm failure becomes the search-failure notice');
fetchHandler = async () => {
	throw new Error('offline');
};
await marketApi.searchMarket('github', 'topic:dsh-theme', 'stars');
check(apiSnapshot().market.detail === 'offline', 'a transport failure keeps its message');

console.log('installing a result');
installCalls.length = 0;
await marketApi.installPlugin('gh:Nwflower/dsh-claude-style', 'github:Nwflower/dsh-claude-style');
check(installCalls[0].spec === 'github:Nwflower/dsh-claude-style', 'installing hands the Host the git address');
check(installCalls[0].options.enabled === true && typeof installCalls[0].options.requestId === 'string', 'installing requests an enabled bundle with a request id');
check(apiSnapshot().jobs['gh:Nwflower/dsh-claude-style']?.code === 'needsBuilds', 'a pending build script is reported on the card');

// ---- live switching ---------------------------------------------------------
console.log('live switching');
enableCalls.length = 0;
bundleList = [
	{ name: '@local/dsh-theme-market', version: '0.1.0', installed: true, enabled: true, optional: false, meta: { title: '主题市场' } },
	{ name: 'dsh-bloom-theme', version: '0.17.6', installed: true, enabled: true, optional: false, meta: { title: 'Bloom 主题' } },
	{ name: 'dsh-theme-endfield', version: '1.2.0', installed: true, enabled: false, optional: false, meta: { title: '终末地主题' } },
	{ name: 'dsh-tokenledger', version: '0.1.0', installed: true, enabled: true, optional: false, description: 'token accounting' },
];
await marketApi.refreshBundles();
check(apiSnapshot().bundles.length === 4, 'the panel reads the profile bundles');
await marketApi.setInstalledEnabled('bundle:dsh-theme-endfield', 'dsh-theme-endfield', true);
check(
	enableCalls.at(-1).name === 'dsh-theme-endfield' && enableCalls.at(-1).enabled === true,
	'enabling a bundle goes through setBundleEnabled',
);
check(apiSnapshot().jobs['bundle:dsh-theme-endfield']?.code === 'enabledLive', 'a live enable says so instead of asking for a restart');
enableCalls.length = 0;
await marketApi.switchTheme('bundle:endfield', 'dsh-theme-endfield');
check(enableCalls[0].name === 'dsh-bloom-theme' && enableCalls[0].enabled === false, 'switching disables the other enabled theme bundle');
check(
	enableCalls.length === 2 && enableCalls[1].name === 'dsh-theme-endfield' && enableCalls[1].enabled === true,
	'switching enables the chosen bundle last',
);
check(!enableCalls.some((call) => call.name === 'dsh-tokenledger'), 'switching leaves non-theme bundles alone');
check(apiSnapshot().jobs['bundle:endfield']?.code === 'enabledLive', 'a live switch reports that it applied');
check(
	!enableCalls.some((call) => call.name === '@local/dsh-theme-market'),
	'switching never disables the panel\'s own bundle, which would remove this very section',
);
enableCalls.length = 0;
await marketApi.setInstalledEnabled('bundle:self', '@local/dsh-theme-market', false);
check(enableCalls.length === 0, 'the panel refuses to switch its own bundle off');
check(apiSnapshot().jobs['bundle:self']?.code === 'selfProtected', 'and it says why on the card');
enableAnswer = { ok: true, value: { changed: true, application: 'restart-required', stage: 'enable', target: 'x' } };
await marketApi.switchTheme('bundle:endfield', 'dsh-theme-endfield');
check(apiSnapshot().jobs['bundle:endfield']?.code === 'restartRequired', 'a Host that cannot apply live asks for a restart instead');
enableAnswer = { ok: false, error: { message: 'nope' } };
await marketApi.setInstalledEnabled('bundle:refused', 'dsh-theme-endfield', true);
check(
	apiSnapshot().jobs['bundle:refused']?.code === 'failed' && apiSnapshot().jobs['bundle:refused']?.detail === 'nope',
	'a refused switch reports the Host message',
);
enableAnswer = { ok: true, value: { changed: true, application: 'applied', stage: 'enable', target: 'x' } };

// ---- scheme previews --------------------------------------------------------
console.log('scheme previews');
const GITHUB_README = '# Bloom\n\n<p align="center"><img src="https://img.example/banner.png" /></p>\n\nMore text. ![shot](./docs/shot.png)\n';
fetchCalls = [];
let previewAnswer = async () => new Response(GITHUB_README, { status: 200 });
globalThis.fetch = async (url, options) => {
	fetchCalls.push({ url, options });
	return previewAnswer(url, options);
};
await marketApi.readResultPreview('gh:a/b', { key: 'gh:a/b', source: 'github', name: 'a/b', spec: 'github:a/b', url: 'https://github.com/a/b' });
let previewState = apiSnapshot().previews['gh:a/b'];
check(fetchCalls[0].url === 'https://api.github.com/repos/a/b/readme', 'a GitHub preview reads the repository README through the API');
check(fetchCalls[0].options.headers.accept === 'application/vnd.github.raw', 'the README request asks for raw text');
check(previewState.status === 'ready' && previewState.images[0] === 'https://img.example/banner.png', 'an absolute screenshot stays as it is');
check(previewState.images[1] === 'https://raw.githubusercontent.com/a/b/HEAD/docs/shot.png', 'a relative screenshot resolves against the repository');
check(previewState.excerpt.includes('Bloom') && !previewState.excerpt.includes('<img'), 'the excerpt is markdown-stripped plain text');
marketApi.storeToken('ghp_test');
fetchCalls = [];
await marketApi.readResultPreview('gh:a/b', { key: 'gh:a/b', source: 'github', name: 'a/b', spec: 'github:a/b' });
check(fetchCalls[0].options.headers.Authorization === 'Bearer ghp_test', 'a saved token is used for the README too');
marketApi.storeToken('');
fetchCalls = [];
previewAnswer = async () => new Response(JSON.stringify({ readme: '# Bloom for DSH\n\n![shot](https://img.example/npm.png)' }), { status: 200 });
await marketApi.readResultPreview('npm:dsh-bloom-theme', { key: 'npm:dsh-bloom-theme', source: 'npm', name: 'dsh-bloom-theme', spec: 'dsh-bloom-theme' });
previewState = apiSnapshot().previews['npm:dsh-bloom-theme'];
check(fetchCalls[0].url === 'https://registry.npmjs.org/dsh-bloom-theme', 'an npm preview reads the registry document');
check(previewState.status === 'ready' && previewState.images[0] === 'https://img.example/npm.png', 'an npm readme screenshot is extracted');
previewAnswer = async () => new Response('nope', { status: 404 });
await marketApi.readResultPreview('npm:x', { key: 'npm:x', source: 'npm', name: 'x', spec: 'x' });
check(
	apiSnapshot().previews['npm:x']?.status === 'error' && apiSnapshot().previews['npm:x']?.code === 'previewFailed',
	'a failed preview read reports itself',
);
marketApi.dropResultPreview('npm:x');
check(apiSnapshot().previews['npm:x'] === undefined, 'collapsing a card drops its preview');
installAnswer = { ok: true, value: { changed: true, application: 'applied', stage: 'install', target: 'x', bundle: 'dsh-theme-demo' } };
installCalls.length = 0;
await marketApi.installPlugin('npm:dsh-theme-demo', 'dsh-theme-demo');
check(apiSnapshot().jobs['npm:dsh-theme-demo']?.code === 'appliedLive', 'a live install reports that the interface switched');
check(installCalls.length === 1, 'the install still goes through installBundle');

// ---- install feedback -------------------------------------------------------
console.log('install feedback');
check(typeof remoteEvents.get('plugin-manager/install-log') === 'function', 'the panel subscribes to the Host install log');
check(typeof remoteEvents.get('plugin-manager/install-state') === 'function', 'the panel subscribes to the Host install progress');
installAnswer = { ok: true, value: { changed: true, application: 'applied', stage: 'install', target: 'x', bundle: 'dsh-demo' } };
installCalls.length = 0;
const pending = marketApi.installPlugin('gh:acme/dsh-demo', 'github:acme/dsh-demo');
const started = apiSnapshot().jobs['gh:acme/dsh-demo'];
check(started?.phase === 'installing' && typeof started.requestId === 'string', 'a click shows an in-flight card immediately, with its request id');
check(started.spec === 'github:acme/dsh-demo', 'the in-flight card remembers the spec it is installing');
remoteEvents.get('plugin-manager/install-log')({ requestId: 'other', text: 'ignored\n' });
check(apiSnapshot().jobs['gh:acme/dsh-demo']?.log === undefined, 'output from another request is ignored');
remoteEvents.get('plugin-manager/install-log')({ requestId: started.requestId, text: 'Progress: resolved\n' });
check(apiSnapshot().jobs['gh:acme/dsh-demo']?.log === 'Progress: resolved\n', 'the pnpm output lands on the card');
remoteEvents.get('plugin-manager/install-state')({ requestId: started.requestId, phase: 'running', attempt: { registry: 'npm', total: 2 } });
check(apiSnapshot().jobs['gh:acme/dsh-demo']?.stage === 'running', 'the Host progress lands on the card');
await pending;
check(apiSnapshot().jobs['gh:acme/dsh-demo']?.code === 'appliedLive', 'the run settles into the applied notice');

// A rejected call must not leave the panel frozen.
pluginManager.installBundle = async () => {
	throw new Error('remote exploded');
};
await marketApi.installPlugin('gh:acme/boom', 'github:acme/boom');
check(
	apiSnapshot().jobs['gh:acme/boom']?.code === 'failed' && apiSnapshot().jobs['gh:acme/boom']?.detail === 'remote exploded',
	'a rejected install reports the failure instead of staying in flight',
);
// A lost reply is recovered through waitForInstall.
let waited = [];
pluginManager.installBundle = async () => ({ ok: false, error: { message: 'reply lost' } });
pluginManager.waitForInstall = async (requestId) => {
	waited.push(requestId);
	return { ok: true, value: { changed: true, application: 'applied', stage: 'install', target: 'x', bundle: 'dsh-recovered' } };
};
await marketApi.installPlugin('gh:acme/recover', 'github:acme/recover');
check(waited.length === 1, 'a lost reply asks the Host for the run it started');
check(apiSnapshot().jobs['gh:acme/recover']?.code === 'appliedLive', 'a recovered run reports its real outcome');

// A network failure on a git spec is named for what it is.
pluginManager.waitForInstall = async () => ({ ok: true, value: null });
pluginManager.installBundle = async () => ({
	ok: true,
	value: {
		changed: false,
		application: 'failed',
		stage: 'install',
		target: 'github:acme/blocked',
		error: { code: 'operation-error', diagnostic: 'GET https://codeload.github.com/acme/blocked/tar.gz error (23)' },
		packageResult: { exitCode: 1, output: '', truncated: false, logPath: '/tmp/x', kind: 'network' },
	},
});
await marketApi.installPlugin('gh:acme/blocked', 'github:acme/blocked');
check(apiSnapshot().jobs['gh:acme/blocked']?.code === 'downloadFailed', 'a blocked GitHub download is reported as such');

// Cancelling frees the panel, with or without a request id.
let cancelled = [];
pluginManager.cancelInstall = async (requestId) => {
	cancelled.push(requestId);
	return { ok: true, value: { changed: false, application: 'cancelled', stage: 'install', target: 'x' } };
};
let release;
pluginManager.installBundle = (spec, options) =>
	new Promise((resolve) => {
		release = () => resolve({ ok: true, value: { changed: true, application: 'applied', stage: 'install', target: spec } });
	});
const stuck = marketApi.installPlugin('gh:acme/stuck', 'github:acme/stuck');
const stuckId = apiSnapshot().jobs['gh:acme/stuck'].requestId;
await marketApi.stopInstall('gh:acme/stuck');
check(cancelled[0] === stuckId, 'cancelling asks the Host to stop that exact request');
check(apiSnapshot().jobs['gh:acme/stuck']?.code === 'cancelling', 'the card stops waiting once cancellation is requested');
marketApi.clearJob('gh:acme/stuck');
check(apiSnapshot().jobs['gh:acme/stuck'] === undefined, 'a card can always drop its notice');
release();
await stuck;
pluginManager.cancelInstall = async () => ({ ok: true, value: { changed: false, application: 'cancelled', stage: 'install', target: 'x' } });
pluginManager.installBundle = async (spec) => ({ ok: true, value: { changed: true, application: 'applied', stage: 'install', target: spec, bundle: 'dsh-quiet' } });
await marketApi.installPlugin('gh:acme/quiet', 'github:acme/quiet');
check(apiSnapshot().jobs['gh:acme/quiet']?.requestId === undefined, 'a settled run keeps no request id, so the card offers dismissal instead of cancelling');

// Without the manager interface the card says so instead of doing nothing.
const bareApi = (() => {
	let captured;
	const ctx = makeCtx('settings.section');
	ctx.remote.pluginManager = {};
	exported.apply(ctx);
	captured = registration.options.inject();
	return captured;
})();
await bareApi.installPlugin('npm:whatever', 'whatever');
check(
	bareApi.hooks.themeMarket.getSnapshot().jobs['npm:whatever']?.code === 'rpcMissing',
	'a missing plugin manager interface is reported on the card',
);

// ---- npm fallback for GitHub results ---------------------------------------
console.log('npm fallback');
fetchCalls = [];
let fallbackAnswer = async (url) => {
	if (url.includes('api.github.com')) return new Response('# Demo\n\nA theme.', { status: 200 });
	return new Response(
		JSON.stringify({
			total: 1,
			objects: [
				{ package: { name: 'dsh-demo-theme', version: '2.0.0', links: { repository: 'https://github.com/acme/dsh-demo-theme' } } },
				{ package: { name: 'unrelated', version: '1.0.0', links: { repository: 'https://github.com/other/unrelated' } } },
			],
		}),
		{ status: 200 },
	);
};
globalThis.fetch = async (url, options) => {
	fetchCalls.push({ url, options });
	return fallbackAnswer(url, options);
};
await marketApi.readResultPreview('gh:acme/dsh-demo-theme', { key: 'gh:acme/dsh-demo-theme', source: 'github', name: 'acme/dsh-demo-theme', spec: 'github:acme/dsh-demo-theme' });
const withAlt = apiSnapshot().previews['gh:acme/dsh-demo-theme'];
check(fetchCalls.length === 2 && fetchCalls[1].url.includes('registry.npmjs.org/-/v1/search'), 'a GitHub preview also asks npm for a published version');
check(withAlt?.npmAlt?.name === 'dsh-demo-theme' && withAlt.npmAlt.version === '2.0.0', 'the npm package whose repository matches is offered');
fallbackAnswer = async (url) => {
	if (url.includes('api.github.com')) return new Response('# Demo', { status: 200 });
	return new Response(JSON.stringify({ total: 0, objects: [] }), { status: 200 });
};
await marketApi.readResultPreview('gh:acme/npm-less', { key: 'gh:acme/npm-less', source: 'github', name: 'acme/npm-less', spec: 'github:acme/npm-less' });
check(apiSnapshot().previews['gh:acme/npm-less']?.npmAlt?.name === undefined, 'a repository with no npm package reports none');

// ---- github archive route ---------------------------------------------------
console.log('github archive route');
marketApi.setMirrorRoute('ghproxy');
fetchCalls = [];
let apiAnswer = async (url) => {
	if (/\/repos\/acme\/demo$/.test(url)) return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
	if (/\/commits\//.test(url)) return new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 });
	if (url.includes('acme/demo2')) return new Response('nope', { status: 500 });
	return new Response('{}', { status: 200 });
};
globalThis.fetch = async (url, options) => {
	fetchCalls.push({ url, options });
	return apiAnswer(url, options);
};
installCalls.length = 0;
pluginManager.installBundle = async (spec, options) => {
	installCalls.push({ spec, options });
	return { ok: true, value: { changed: true, application: 'applied', stage: 'install', target: spec, bundle: 'dsh-demo' } };
};
await marketApi.installResult('gh:acme/demo', { key: 'gh:acme/demo', source: 'github', name: 'acme/demo', spec: 'github:acme/demo', url: 'https://github.com/acme/demo' });
check(
	installCalls[0]?.spec === 'https://ghproxy.net/https://github.com/acme/demo/archive/abc123.tar.gz',
	'a GitHub result installs from its commit archive through the chosen mirror, not through git',
);
check(fetchCalls[0].url === 'https://api.github.com/repos/acme/demo', 'the default branch is read from the GitHub API');
check(fetchCalls[1].url.includes('/commits/main'), 'the commit is read for the default branch, so the address is pinned');
check(
	marketApi.hooks.themeMarket.getSnapshot().sources['acme/demo']?.status === 'ready',
	'the resolved address is part of the panel snapshot',
);
const cachedCalls = fetchCalls.length;
await marketApi.resolveSourceSpec({ name: 'acme/demo', source: 'github' });
check(fetchCalls.length === cachedCalls, 'a resolved address is cached instead of re-resolved');
await marketApi.installResult('gh:acme/demo2', { key: 'gh:acme/demo2', source: 'github', name: 'acme/demo2', spec: 'github:acme/demo2' });
check(
	apiSnapshot().sources['acme/demo2']?.spec === 'github:acme/demo2',
	'a repository whose lookup fails falls back to the github: shorthand',
);
marketApi.setMirrorRoute('ghfast');
check(apiSnapshot().mirror === 'ghfast', 'the GitHub route is switchable');
check(apiSnapshot().sources['acme/demo'] === undefined, 'switching the route drops addresses resolved under the old one');
marketApi.setMirrorRoute('ghproxy');
apiAnswer = async (url) => {
	if (/\/repos\/acme\/plain$/.test(url)) return new Response(JSON.stringify({ default_branch: 'master' }), { status: 404 });
	return new Response('{}', { status: 404 });
};
const direct = await marketApi.resolveSourceSpec({ name: 'acme/plain', source: 'github' });
check(direct.status === 'error' && direct.spec === 'github:acme/plain', 'an unreachable API read is reported as a failed resolution');
await marketApi.installResult('npm:dsh-demo-theme', { key: 'npm:dsh-demo-theme', source: 'npm', name: 'dsh-demo-theme', spec: 'dsh-demo-theme' });
check(installCalls.at(-1)?.spec === 'dsh-demo-theme', 'an npm result keeps installing by package name');

// A see-through measured surface is what turns the repair on by itself.
measuredSurface = 'rgba(22,27,36,0.62)';
const autoRepair = (() => {
	exported.apply(makeCtx('settings.section'));
	return registration.options.inject();
})();
check(
	autoRepair.hooks.themeMarket.getSnapshot().repair === true,
	'a see-through Settings surface turns the repair on by itself',
);
check(headStyles.get('@local/dsh-theme-market/surface-repair.css') !== undefined, 'and the stylesheet is installed at load');
autoRepair.setSurfaceRepair(false);
measuredSurface = '#ffffff';
const opaqueRun = (() => {
	exported.apply(makeCtx('settings.section'));
	return registration.options.inject();
})();
check(
	opaqueRun.hooks.themeMarket.getSnapshot().repair === false,
	'an opaque surface leaves the repair off, so a plain install stays untouched',
);
measuredSurface = '';

// ---- opaque surface repair --------------------------------------------------
console.log('surface repair');
const repairKey = '@local/dsh-theme-market/surface-repair.css';
marketApi.setSurfaceRepair(true);
const repairSheet = headStyles.get(repairKey);
check(repairSheet !== undefined, 'turning the repair on installs this plugin\'s own stylesheet');
check(
	repairSheet.textContent.includes('--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-00,#fff)!important'),
	'the repair forces the light dialog surface back to the app value with !important',
);
check(
	repairSheet.textContent.includes('--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-850,#2c2c2e)!important'),
	'the repair does the same for the dark scheme',
);
check(repairSheet.textContent.includes('[role="dialog"]'), 'the repair targets dialogs, which is what the Settings panel is');
check(apiSnapshot().repair === true, 'the repair state is part of the panel snapshot');
marketApi.setSurfaceRepair(false);
check(headStyles.get(repairKey) === undefined, 'turning the repair off removes the stylesheet again');
check(apiSnapshot().repair === false, 'and the state follows');

// ---- render -----------------------------------------------------------------
console.log('render');
const render = (state, overrides = {}) => {
	stateSlots = state ?? [];
	stateIndex = 0;
	const resolve = (key) => zh[key] ?? `[${key}]`;
	return registration.component({ t: resolve, ...registration.options.inject(), ...overrides });
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

const themesPage = render([], { useThemeMarket: (selector) => selector({ preference: 'system', scheme: 'light', fontSize: 14, selection: null, preview: null, jobs: {}, market: { source: 'github', status: 'idle', items: [] } }) });
const themesText = textsOf(themesPage);
check(themesText.includes(zh.title) && themesText.includes(zh.tabThemes) && themesText.includes(zh.tabMarket), 'the section renders its title and both tabs');
check(themesText.includes(zh.presetOceanName) && themesText.includes(zh.presetMonoName), 'the preset schemes render');
check(find(themesPage, (node) => node.type === 'li' && node.props.className === 'tm_card').length >= 8, 'every ready-made scheme gets a card');
const previews = find(themesPage, (node) => node.props.className === 'tm_pv');
check(previews.length === 18, 'each of the eight scheme cards renders a light and a dark preview, plus the custom composer\'s pair');
const oceanPreview = previews.find((node) => node.props.style['--dsw-alias-brand-primary'] === '#2F6BFF');
check(oceanPreview !== undefined, 'a preview carries the candidate accent as an inline token');
check(oceanPreview.props.style['--dsw-alias-bg-base'] !== undefined, 'a preview also carries the neutral base palette for its scheme');
check(find(themesPage, (node) => node.props['data-preset-preview'] === 'ocean').length === 1, 'each scheme offers a preview control');
check(find(themesPage, (node) => node.type === 'input' && node.props.type === 'color').length === 1, 'the custom composer offers an accent picker');

const previewCalls = [];
const applyCalls = [];
const interactive = render([], {
	useThemeMarket: (selector) => selector({ preference: 'system', scheme: 'light', fontSize: 14, selection: null, preview: null, jobs: {}, market: { source: 'github', status: 'idle', items: [] } }),
	previewScheme: (item) => previewCalls.push(item),
	applyScheme: (item) => applyCalls.push(item),
});
find(interactive, (node) => node.props['data-preset-preview'] === 'amber')[0].props.onClick();
find(interactive, (node) => node.props['data-preset-apply'] === 'amber')[0].props.onClick();
check(previewCalls[0]?.key === 'amber' && applyCalls[0]?.key === 'amber', 'preview and apply both carry the chosen scheme');
find(interactive, (node) => node.props['data-custom-preview'] === 'true')[0].props.onClick();
check(previewCalls[1]?.kind === 'custom' && previewCalls[1].radius === 12, 'the custom composer previews its draft');

const marketSnapshot = {
	preference: 'system',
	scheme: 'light',
	fontSize: 14,
	selection: null,
	preview: null,
	jobs: {},
	market: {
		source: 'github',
		status: 'ready',
		total: 35,
		items: [{ key: 'gh:a/b', source: 'github', name: 'a/b', spec: 'github:a/b', url: 'https://github.com/a/b', stars: 12, updated: '2026-10-09' }],
		rate: { limit: 10, remaining: 6, reset: 1791657619 },
	},
};
const installs = [];
const installResults = [];
const searches = [];
const idleMarket = { source: 'github', status: 'idle', items: [] };
render(['market', undefined, 'github', 'topic:dsh-theme', 'keywords:dsh-theme', 'stars', '', false], {
	useThemeMarket: (selector) => selector({ ...marketSnapshot, market: idleMarket }),
	searchMarket: (source, query, sort) => searches.push({ source, query, sort }),
});
check(
	searches.length === 1 && searches[0].source === 'github' && searches[0].query === 'topic:dsh-theme' && searches[0].sort === 'stars',
	'opening the market tab runs the default search once',
);
const marketPage = render(['market', undefined, 'github', 'topic:dsh-theme', 'keywords:dsh-theme', 'stars', '', false], {
	useThemeMarket: (selector) => selector(marketSnapshot),
	searchMarket: (source, query, sort) => searches.push({ source, query, sort }),
	installPlugin: (key, spec) => installs.push({ key, spec }),
	installResult: (key, item) => installResults.push({ key, item }),
});
const marketText = textsOf(marketPage);
check(marketText.includes(zh.marketIntro) && marketText.includes(zh.trust), 'the market tab renders its intro and trust note');
check(marketText.includes('a/b') && marketText.includes('github:a/b') && marketText.includes('★ 12'), 'a result card renders its repository, spec and stars');
check(marketText.includes(`${zh.total} 35`), 'the result summary reports the total');
check(marketText.includes(`${zh.quota} 6/10`), 'the quota line reports the remaining searches');
check(find(marketPage, (node) => node.type === 'a' && node.props.href === 'https://github.com/a/b').length >= 1, 'a result links out to its homepage');
const installButton = find(marketPage, (node) => node.props['data-install'] === 'gh:a/b')[0];
installButton.props.onClick();
check(
	installResults[0]?.key === 'gh:a/b' && installResults[0]?.item?.name === 'a/b',
	'the install action hands the whole GitHub result to the archive resolver',
);

const limitedPage = render(['market', undefined, 'github', 'topic:dsh-theme', 'keywords:dsh-theme', 'stars', '', false], {
	useThemeMarket: (selector) => selector({ ...marketSnapshot, market: { source: 'github', status: 'error', code: 'rateLimited', detail: 'API rate limit exceeded', items: [] } }),
});
check(textsOf(limitedPage).includes(zh.rateLimited) && textsOf(limitedPage).includes(zh.retry), 'a rate-limited search renders its notice and a retry');

const appliedPage = render([], {
	useThemeMarket: (selector) =>
		selector({ preference: 'dark', scheme: 'dark', fontSize: 16, selection: { kind: 'preset', key: 'violet' }, preview: null, jobs: {}, market: { source: 'github', status: 'idle', items: [] } }),
});
check(textsOf(appliedPage).includes(`${zh.active}: ${zh.presetVioletName}`), 'the active bar names the applied scheme');
check(textsOf(appliedPage).includes('16px'), 'the active bar shows the current content font size');

console.log('render: installed themes and result previews');
const themesSnapshot = {
	...marketSnapshot,
	bundles: [
		{ name: '@local/dsh-theme-market', installed: true, enabled: true, meta: { title: '主题市场' } },
		{ name: 'dsh-bloom-theme', installed: true, enabled: true, meta: { title: 'Bloom 主题', description: 'Bloom skin' } },
		{ name: 'dsh-theme-endfield', installed: true, enabled: false, meta: { title: '终末地主题' } },
		{ name: 'dsh-tokenledger', installed: true, enabled: true, description: 'token accounting' },
	],
	previews: {
		'gh:dsh-bloom-theme': { status: 'ready', images: ['https://img.example/a.png'], excerpt: 'Bloom preview text', empty: false },
	},
	market: {
		source: 'github',
		status: 'ready',
		total: 2,
		items: [
			{ key: 'gh:dsh-bloom-theme', source: 'github', name: 'dsh-bloom-theme', spec: 'github:dsh-bloom-theme', url: 'https://github.com/x/dsh-bloom-theme', stars: 9, updated: '2026-10-01' },
			{ key: 'gh:other/repo', source: 'github', name: 'other/repo', spec: 'github:other/repo', url: 'https://github.com/other/repo', stars: 1 },
		],
	},
};
const switchCalls = [];
const toggleCalls = [];
const previewReads = [];
const page2 = render(['market', undefined, 'github', 'topic:dsh-theme', 'keywords:dsh-theme', 'stars', '', false], {
	useThemeMarket: (selector) => selector(themesSnapshot),
	switchTheme: (key, name) => switchCalls.push({ key, name }),
	setInstalledEnabled: (key, name, enabled) => toggleCalls.push({ key, name, enabled }),
	readResultPreview: (key, item) => previewReads.push({ key, item }),
	dropResultPreview: () => {},
});
const text2 = textsOf(page2);
check(text2.includes(zh.installedThemes) && text2.includes(zh.installedThemesHint), 'the market tab lists installed theme plugins');
check(
	text2.includes('Bloom 主题') && text2.includes('终末地主题') && !text2.includes('dsh-tokenledger'),
	'only theme-shaped bundles are listed as installed themes',
);
check(
	find(page2, (node) => node.props['data-toggle-installed'] === '@local/dsh-theme-market').length === 0,
	'the panel itself never appears in the list it offers to switch off',
);
check(find(page2, (node) => node.props['data-disable-all'] === 'true').length === 1, 'the installed list offers a disable-all control');
find(page2, (node) => node.props['data-switch-bundle'] === 'dsh-theme-endfield')[0].props.onClick();
check(switchCalls[0]?.name === 'dsh-theme-endfield', 'an installed theme can be switched with one click');
find(page2, (node) => node.props['data-toggle-installed'] === 'dsh-bloom-theme')[0].props.onClick();
check(toggleCalls[0]?.name === 'dsh-bloom-theme' && toggleCalls[0]?.enabled === false, 'an installed theme can be switched off');
const stateTag = find(page2, (node) => node.props['data-state'] === 'gh:dsh-bloom-theme');
check(textsOf(stateTag[0]).includes(zh.stateEnabled), 'a result that is already installed shows its live state');
check(find(page2, (node) => node.props['data-install'] === 'gh:dsh-bloom-theme').length === 0, 'an installed result offers no install button');
check(find(page2, (node) => node.props['data-switch'] === 'gh:dsh-bloom-theme').length === 1, 'an installed result offers the live switch');
check(find(page2, (node) => node.props['data-install'] === 'gh:other/repo').length === 1, 'an uninstalled result still offers install-and-try');
find(page2, (node) => node.props['data-preview-toggle'] === 'gh:other/repo')[0].props.onClick();
check(previewReads[0]?.key === 'gh:other/repo', 'opening a scheme preview reads that result');
const expandedPage = render(['market', undefined, 'github', 'topic:dsh-theme', 'keywords:dsh-theme', 'stars', '', false, 'gh:dsh-bloom-theme'], {
	useThemeMarket: (selector) => selector(themesSnapshot),
});
check(textsOf(expandedPage).includes('Bloom preview text'), 'an expanded preview renders its README excerpt');
const shots = find(expandedPage, (node) => node.props.className === 'tm_shot');
check(shots.length === 1 && shots[0].props.src === 'https://img.example/a.png', 'an expanded preview renders its screenshots');
check(textsOf(expandedPage).includes(zh.previewNote), 'an expanded preview says where the material comes from');
check(textsOf(expandedPage).includes(zh.gitBuildHint), 'a GitHub preview warns that a source-only install may not take effect');

console.log('render: install feedback');
const runningJob = { phase: 'installing', code: 'installing', requestId: 'r1', spec: 'github:acme/dsh-demo', log: 'Progress: resolved 1\n[WARN] GET https://codeload.github.com/... error (23)\n', stage: 'running' };
const runningSnapshot = {
	...themesSnapshot,
	jobs: { 'gh:other/repo': runningJob },
};
const runningPage = render(['market', undefined, 'github', 'topic:dsh-theme', 'keywords:dsh-theme', 'stars', '', false], {
	useThemeMarket: (selector) => selector(runningSnapshot),
	stopInstall: () => {},
});
const runningText = textsOf(runningPage);
check(runningText.includes(zh.installing), 'an install in flight says so on its card');
check(runningText.includes('codeload.github.com'), 'the card shows the pnpm output while the run is in flight');
check(find(runningPage, (node) => node.props['data-cancel'] === 'true').length >= 1, 'an in-flight run can be cancelled from its card');

const failedSnapshot = {
	...themesSnapshot,
	jobs: { 'gh:other/repo': { phase: 'error', code: 'downloadFailed', detail: 'GET https://codeload.github.com/acme/dsh-demo/tar.gz error (23)', spec: 'github:acme/dsh-demo' } },
};
const failedPage = render(['market', undefined, 'github', 'topic:dsh-theme', 'keywords:dsh-theme', 'stars', '', false], {
	useThemeMarket: (selector) => selector(failedSnapshot),
});
const failedText = textsOf(failedPage);
check(failedText.includes(zh.downloadFailed) && failedText.includes(zh.downloadHint), 'a blocked download explains itself and what to do');
check(find(failedPage, (node) => node.props['data-retry'] === 'true').length >= 1, 'a failed install offers a retry');
check(find(failedPage, (node) => node.props['data-clear'] === 'true').length >= 1, 'a settled notice can be dismissed');

const altSnapshot = {
	...themesSnapshot,
	previews: {
		'gh:other/repo': {
			status: 'ready',
			images: [],
			excerpt: 'A theme',
			empty: false,
			npmStatus: 'ready',
			npmAlt: { name: 'dsh-demo-theme', version: '2.0.0' },
		},
	},
};
const altPage = render(['market', undefined, 'github', 'topic:dsh-theme', 'keywords:dsh-theme', 'stars', '', false, 'gh:other/repo'], {
	useThemeMarket: (selector) => selector(altSnapshot),
});
check(textsOf(altPage).includes(`${zh.npmFound}: dsh-demo-theme@2.0.0`), 'a preview names the npm version it found');
check(find(altPage, (node) => node.props['data-install'] === 'npm:dsh-demo-theme').length === 1, 'the npm version can be installed with one click');

console.log(failures.length === 0 ? '\nPASS' : `\nFAIL (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);

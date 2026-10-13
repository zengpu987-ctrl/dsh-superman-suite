/**
 * Check every `--dsw-*` token the theme market can emit against the token
 * catalog the installed ui-theme package defines. A mistyped token name would
 * silently retint nothing, so this check reads the app bundle and the plugin
 * side by side.
 *
 * Usage: node tools/theme-token-check.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ARCHIVE = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const THEME_CLIENT = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js';
const PKG_DIR = resolve(import.meta.dirname, '../theme-market');

// ---- read the installed token catalog ---------------------------------------
const archive = readFileSync(ARCHIVE);
const pickleSize = archive.readUInt32LE(4);
const jsonSize = archive.readUInt32LE(12);
const header = JSON.parse(archive.subarray(16, 16 + jsonSize).toString('utf8'));
const baseOffset = 8 + pickleSize;
const find = (target) => {
	let node = header;
	for (const part of target.split('/').filter(Boolean)) {
		if (!node.files?.[part]) return undefined;
		node = node.files[part];
	}
	return node;
};
const node = find(THEME_CLIENT);
if (node === undefined) {
	console.error(`cannot read ${THEME_CLIENT} from ${ARCHIVE}`);
	process.exit(2);
}
const start = baseOffset + Number(node.offset);
const themeSource = archive.subarray(start, start + node.size).toString('utf8');
const catalog = new Set([...themeSource.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));

// ---- collect the tokens the plugin emits ------------------------------------
const storage = new Map();
globalThis.localStorage = {
	getItem: (key) => (storage.has(key) ? storage.get(key) : null),
	setItem: (key, value) => storage.set(key, String(value)),
	removeItem: (key) => storage.delete(key),
};
globalThis.document = {
	head: { appendChild: () => {} },
	querySelector: () => null,
	createElement: () => ({ dataset: {}, style: {}, remove() {} }),
};
const react = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
	useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
	useEffect: () => {},
};
let definition;
globalThis.window = { __ModuleLoader__: { load: (declared) => (definition = declared) } };
await import(pathToFileURL(resolve(PKG_DIR, 'client.js')).href);
const exported = definition.factory((name) => {
	if (name === 'react') return react;
	throw new Error(`unexpected require(${name})`);
});

const emitted = new Set();
let registration;
exported.apply({
	locale: { bind: () => (key) => key, register: () => () => {} },
	effect: (factory) => {
		factory();
		return () => {};
	},
	theme: {
		getTheme: () => ({ preference: 'system', fontSize: 14, active: { colorScheme: 'light' } }),
		setTheme: () => {},
		setFontSize: () => {},
		overrideTokens: (source, tokens) => {
			for (const name of Object.keys(tokens)) emitted.add(name);
			return () => {};
		},
	},
	on: () => () => {},
	remote: {
		pluginManager: {
			installBundle: async () => ({ ok: true, value: {} }),
			listBundles: async () => ({ ok: true, value: [] }),
			setBundleEnabled: async () => ({ ok: true, value: {} }),
		},
		$on: () => () => {},
	},
	slots: {
		inject: (name, callback) => callback(),
		register: (options, component) => {
			registration = { options, component };
			return () => {};
		},
	},
});
const actions = registration.options.inject();
for (const key of ['default', 'ocean', 'forest', 'amber', 'violet', 'rose', 'mono', 'soft']) {
	actions.applyScheme({ kind: 'preset', key });
}
actions.applyScheme({ kind: 'custom', accent: '#123456', radius: 0, strength: 'strong' });

const missing = [...emitted].filter((name) => !catalog.has(name)).sort();
console.log(`emitted tokens: ${emitted.size}`);
console.log(`catalog tokens: ${catalog.size}`);
for (const name of [...emitted].sort()) console.log(`  ${catalog.has(name) ? 'ok  ' : 'MISS'} ${name}`);
if (missing.length > 0) {
	console.error(`\nFAIL: ${missing.length} emitted token(s) are not defined by ui-theme: ${missing.join(', ')}`);
	process.exit(1);
}
console.log('\nPASS: every emitted token is part of the installed theme catalog');

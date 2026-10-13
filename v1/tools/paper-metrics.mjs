/**
 * Collect the measurements the paper reports.
 *
 * Everything here is measured, not estimated: the shipped Chat bundle's own PDF
 * reader and decoder run over a real corpus, the math renderer runs over the
 * expression battery, and the totals come from the files themselves.
 *
 * Usage: node tools/paper-metrics.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadClient } from './chat-mode-load.mjs';

const here = process.cwd();
/** Run one async operation and report its wall-clock time. */
async function timed(operation, rounds = 3) {
	const times = [];
	let value;
	for (let round = 0; round < rounds; round += 1) {
		const started = process.hrtime.bigint();
		value = await operation();
		times.push(Number(process.hrtime.bigint() - started) / 1e6);
	}
	times.sort((left, right) => left - right);
	return { value, medianMs: times[Math.floor(times.length / 2)], times };
}

/**
 * Publish-safe aliases assigned by position in the scan. The corpus contains
 * personal documents (a transcript, a contract, a prospectus), so neither the
 * scripts nor the published data carry their real file names.
 */
const CORPUS_ALIASES = [
	'brochure.pdf',
	'document-B.pdf',
	'prospectus-2025.pdf',
	'prospectus-2026.pdf',
	'contract-2027.pdf',
];

const { module } = loadClient('chat-mode');
const { extractPdfText, decodeUploadText, texToMathML, renderRich, classifyFile } = module.internal;

//#region the PDF corpus
const candidates = [];
const CORPUS_DIRS = [
	process.env.DSH_TEST_CORPUS,
	join(homedir(), 'Downloads'),
	'/System/Library/Frameworks/Automator.framework/Resources',
].filter(Boolean);
for (const directory of CORPUS_DIRS) {
	if (!existsSync(directory)) continue;
	for (const name of readdirSync(directory)) {
		if (!name.toLowerCase().endsWith('.pdf')) continue;
		candidates.push(join(directory, name));
	}
}
const aliasOf = (index) => CORPUS_ALIASES[index] ?? `system-art-${Math.max(1, index - CORPUS_ALIASES.length + 1)}.pdf`;
const corpus = [];
for (const path of candidates.slice(0, 14)) {
	const bytes = new Uint8Array(readFileSync(path));
	try {
		const { value, medianMs } = await timed(() => extractPdfText(bytes));
		corpus.push({
			name: aliasOf(candidates.indexOf(path)),
			bytes: bytes.length,
			medianMs: Number(medianMs.toFixed(1)),
			characters: value.text.length,
			cjk: (value.text.match(/[\u3400-\u9fff]/g) ?? []).length,
			noise: (value.text.match(/[\ufffd\u0080-\u009f]/g) ?? []).length,
			pages: value.pages ?? 0,
			note: value.note ?? '',
			charsPerPage: value.pages > 0 ? Math.round(value.text.length / value.pages) : 0,
		});
	} catch (error) {
		corpus.push({ name: aliasOf(candidates.indexOf(path)), bytes: bytes.length, error: String(error).slice(0, 80) });
	}
}
//#endregion

//#region encoding detection
const ascii = (value) => [...value].map((character) => character.charCodeAt(0));
const cases = [
	{ label: 'UTF-8', bytes: new TextEncoder().encode('记忆体 memory 记忆'), expect: 'utf-8' },
	{ label: 'UTF-8 BOM', bytes: Uint8Array.from([0xef, 0xbb, 0xbf, ...ascii('bom')]), expect: 'utf-8' },
	{ label: 'GBK', bytes: Uint8Array.from([...ascii('a'), 0xc4, 0xe3, 0xba, 0xc3]), expect: 'gbk' },
	{ label: 'Big5', bytes: Uint8Array.from([0xa4, 0xa4, 0xa4, 0xe5]), expect: 'big5' },
	{ label: 'UTF-16LE (no BOM)', bytes: (() => {
		const text = 'hi 你好';
		const out = new Uint8Array(text.length * 2);
		[...text].forEach((character, index) => {
			const code = character.charCodeAt(0);
			out[index * 2] = code & 0xff;
			out[index * 2 + 1] = code >> 8;
		});
		return out;
	})(), expect: 'utf-16le' },
	{ label: 'PNG header', bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49]), expect: 'binary' },
	{ label: 'random high bytes', bytes: Uint8Array.from({ length: 256 }, (_, index) => (index * 37 + 129) & 0xff), expect: 'binary' },
];
const encodings = cases.map((entry) => {
	const decoded = decodeUploadText(entry.bytes);
	return {
		label: entry.label,
		expected: entry.expect,
		detected: decoded.binary ? 'binary' : decoded.encoding,
		correct: (decoded.binary ? 'binary' : decoded.encoding) === entry.expect,
		plausibility: Number(module.internal.textPlausibility(decoded.text).toFixed(3)),
	};
});
//#endregion

//#region math rendering
const battery = [
	'E = mc^2',
	'\\frac{\\partial f}{\\partial x}',
	'\\vec{F} = m\\vec{a}',
	'\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
	'\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
	'\\oint_{\\partial \\Omega} \\vec{E} \\cdot d\\vec{A} = \\frac{Q}{\\varepsilon_0}',
	'\\begin{aligned} a &= b + c \\\\ d &= e - f \\end{aligned}',
	'\\left[ \\begin{matrix} 1 & 0 \\\\ 0 & 1 \\end{matrix} \\right]',
	'\\begin{cases} x^2 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}',
	'{}^{238}_{92}\\mathrm{U}',
	'\\nabla \\times \\vec{B} = \\mu_0 \\vec{J}',
	'\\hat{H}\\psi = E\\psi',
	'\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e',
	'\\mathbb{E}[X] = \\int x \\, dP',
	'\\theta \\in [0, 2\\pi)',
	'\\mathcal{O}(n \\log n)',
];
const math = battery.map((expression) => {
	const markup = texToMathML(expression, true);
	return {
		expression,
		markupLength: markup.length,
		valid: markup.startsWith('<math') && markup.includes('</math>'),
		backslashLeak: /\\/.test(markup),
		tables: (markup.match(/<mtable>/g) ?? []).length,
		fractions: (markup.match(/<mfrac>/g) ?? []).length,
		scripts: (markup.match(/<msub|<\/msub>|<msup|<msubsup/g) ?? []).length,
	};
});
const rendered = renderRich(['解：由高斯定理', '', '$$\\oint_{\\partial \\Omega} \\vec{E} \\cdot d\\vec{A} = \\frac{Q}{\\varepsilon_0}$$', '', '其中 $\\varepsilon_0$ 是常数。'].join('\n'));
let mathNodes = 0;
const walk = (node) => {
	if (node === null || node === undefined) return;
	if (Array.isArray(node)) {
		node.forEach(walk);
		return;
	}
	if (typeof node.type === 'function') {
		walk(node.type(node.props));
		return;
	}
	if (node.props?.dangerouslySetInnerHTML?.__html !== undefined) mathNodes += 1;
	(node.children ?? []).forEach(walk);
};
walk(rendered);
//#endregion

//#region source and suite inventory
const modules = ['chat-mode', 'superman', 'arxiv-search'];
const inventory = [];
for (const name of modules) {
	const directory = join(here, name);
	const files = readdirSync(directory).filter((file) => file.endsWith('.js'));
	let lines = 0;
	let bytes = 0;
	const parts = [];
	for (const file of files) {
		const source = readFileSync(join(directory, file), 'utf8');
		const count = source.split('\n').length;
		lines += count;
		bytes += statSync(join(directory, file)).size;
		parts.push({ file, lines: count });
	}
	inventory.push({ module: name, lines, bytes, files: parts });
}
const suites = [
	['chat-mode-check.mjs', 'pipeline'],
	['chat-mode-format-check.mjs', 'rendering and decoding'],
	['superman-host-check.mjs', 'memory host half'],
	['superman-check.mjs', 'memory panel'],
	['arxiv-smoke.mjs', 'arXiv bundle'],
];
const suiteSizes = suites.map(([file, purpose]) => {
	const source = readFileSync(join(here, 'tools', file), 'utf8');
	return { suite: file, purpose, lines: source.split('\n').length };
});
//#endregion

/** The one classification probe the paper reports. */
const classification = [
	['paper.pdf', 'application/pdf', '%PDF-1.7'],
	['shot.png', 'image/png', '\\x89PNG'],
	['solver.py', '', '#!/usr/bin/env python3'],
	['notes.txt', 'text/plain', '会议纪要'],
	['archive.zip', 'application/zip', 'PK\\x03\\x04'],
].map(([name, mime, head]) => {
	const bytes = Uint8Array.from([...head].map((character) => character.charCodeAt(0) & 0xff));
	return { name, mime, head: head.replace(/[\x00-\x1f]/g, '.'), expected: classifyFile({ name, type: mime, size: bytes.length }), kind: classifyFile({ name, type: mime, size: bytes.length }) };
});

const metrics = {
	generatedAt: new Date().toISOString(),
	corpus,
	encodings,
	math: { battery: math, renderedMathNodes: mathNodes },
	inventory,
	suiteSizes,
	classification,
};
mkdirSync(join(here, 'papers', 'data'), { recursive: true });
writeFileSync(join(here, 'papers', 'data', 'metrics.json'), `${JSON.stringify(metrics, null, 1)}\n`);

console.log(`corpus: ${corpus.length} PDFs, ${corpus.reduce((total, entry) => total + (entry.characters ?? 0), 0)} characters extracted`);
for (const entry of corpus) console.log(`  ${String(entry.medianMs ?? '-').padStart(7)} ms  ${String(entry.characters ?? 0).padStart(7)} ch  ${String(entry.cjk ?? 0).padStart(6)} cjk  ${String(entry.pages ?? 0).padStart(3)} p  ${entry.note ?? ''}  ${entry.name}`);
console.log(`encodings: ${encodings.filter((entry) => entry.correct).length}/${encodings.length} correct`);
console.log(`math: ${math.filter((entry) => entry.valid && !entry.backslashLeak).length}/${math.length} clean`);
console.log(`inventory: ${inventory.map((entry) => `${entry.module} ${entry.lines}`).join(', ')}`);
console.log(`wrote papers/data/metrics.json`);

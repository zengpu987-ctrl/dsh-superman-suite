/**
 * Offline checks for the Superman OCR bundle's host half.
 *
 * It loads the real `superman-ocr/index.js` against a fake cordis context and a
 * temporary work directory, then drives the route end to end: the JSON
 * envelope, the error statuses, the page-budget clamping, the temporary-file
 * lifecycle, and — through a fake `swiftc` — the compile-on-first-use path
 * (one compile for concurrent callers, a cached binary for later processes,
 * and a clear `compile-failed` when the compiler fails).
 *
 * Nothing here needs the real OCR engine: `config.bin` points at a small shell
 * script that stands in for the compiled tool. Set `DSH_OCR_E2E=1` to also
 * compile `tools/ocr-pdf.swift` with the real `swiftc` and OCR a generated
 * one-page PDF (slow; skipped with a printed note when `swiftc` is absent).
 *
 * Usage: node tools/superman-ocr-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** A temporary directory this machine really lets us write to. */
async function scratchRoot() {
	const tried = [];
	for (const base of [tmpdir(), '/tmp']) {
		try {
			return await mkdtemp(join(base, 'superman-ocr-check-'));
		} catch (error) {
			tried.push(`${base}: ${error.code ?? error.message}`);
		}
	}
	throw new Error(`no writable temporary directory (${tried.join('; ')})`);
}

/** Write one executable script. */
function script(path, body) {
	writeFileSync(path, body, 'utf8');
	chmodSync(path, 0o755);
}

const root = await scratchRoot();
const workDir = join(root, 'work');
const buildDir = join(root, 'build');
const state = {
	mode: join(root, 'mode'),
	swiftcMode: join(root, 'swiftc-mode'),
	swiftcCalls: join(root, 'swiftc-calls'),
};

/** The stand-in for the compiled tool: prints a marker and echoes its argv. */
const fakeBin = `#!/bin/sh
# Offline stand-in for the compiled ocr-pdf tool.
state="${root}"
mode="$(cat "$state/mode" 2>/dev/null || echo ok)"
if [ "$1" = "--version" ]; then
  echo 'fake-ocr 9.9.9'
  exit 0
fi
case "$mode" in
  fail)
    echo 'ocr-pdf: page 1 could not be rendered' >&2
    exit 3
    ;;
  twopage)
    printf '## page 1\\n甲\\n## page 2\\n乙\\n'
    exit 0
    ;;
  empty)
    exit 0
    ;;
  huge)
    printf '## page 1\\n'
    head -c 500000 /dev/zero | tr '\\0' 'A'
    printf '\\n'
    exit 0
    ;;
esac
printf '## page 1\\n识别结果\\n'
printf 'ARGS:'
for a in "$@"; do printf ' %s' "$a"; done
printf '\\n'
exit 0
`;

/** The stand-in for swiftc: records its arguments and installs the fake tool. */
const fakeSwiftc = `#!/bin/sh
# Offline stand-in for swiftc: records the call and installs the fake tool.
state="${root}"
echo "$@" >> "$state/swiftc-calls"
mode="$(cat "$state/swiftc-mode" 2>/dev/null || echo ok)"
out=''
prev=''
for a in "$@"; do
  if [ "$prev" = '-o' ]; then out="$a"; fi
  prev="$a"
done
if [ "$mode" = 'slow' ]; then sleep 0.4; fi
if [ "$mode" = 'fail' ]; then
  echo "error: no such module 'Vision'" >&2
  exit 1
fi
if [ "$mode" = 'noop' ]; then exit 0; fi
if [ -z "$out" ]; then echo 'swiftc: missing -o' >&2; exit 2; fi
mkdir -p "$(dirname "$out")"
cp "$state/fake-bin" "$out"
chmod +x "$out"
exit 0
`;

script(join(root, 'fake-bin'), fakeBin);
script(join(root, 'fake-swiftc'), fakeSwiftc);
writeFileSync(state.mode, 'ok', 'utf8');
writeFileSync(state.swiftcMode, 'ok', 'utf8');
writeFileSync(state.swiftcCalls, '', 'utf8');

/** A tiny but real PDF, so the route's magic-byte check passes. */
const pdfBytes = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');

/** Count the compile calls recorded by the fake swiftc. */
function compileCalls() {
	const text = existsSync(state.swiftcCalls) ? execFileSync('/bin/cat', [state.swiftcCalls], { encoding: 'utf8' }) : '';
	return text.split('\n').filter((line) => line.trim() !== '');
}

/**
 * Load the real module and register it against a fresh fake cordis context.
 * @param config - the row configuration to apply.
 * @returns the captured routes and the module.
 */
async function loadBundle(config) {
	const routes = new Map();
	const ctx = {
		effect: (fn) => fn(),
		get: () => undefined,
		on: () => () => {},
		connection: {
			fetch: {
				register(route) {
					routes.set(route.path, route);
					return () => {};
				},
			},
		},
	};
	ctx.inject = (deps, callback) => callback(ctx);
	const module = await import(new URL('../superman-ocr/index.js', import.meta.url).href);
	module.apply(ctx, config);
	return { routes, module };
}

/** Ask one route one command. */
async function command(route, body, options = {}) {
	const response = await route.fetch(new Request('http://127.0.0.1:19387/api/superman-ocr/api', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		...(options.signal === undefined ? {} : { signal: options.signal }),
	}));
	return { status: response.status, payload: await response.json() };
}

/* ------------------------------------------------------------------ *
 * The route, the envelope, and the argument checks (fake binary)
 * ------------------------------------------------------------------ */
const fake = await loadBundle({ bin: join(root, 'fake-bin'), workDir, maxPages: 40, timeoutMs: 30_000 });
const route = fake.routes.get('/api/superman-ocr/api');
check(route !== undefined, 'the command route is registered at /api/superman-ocr/api');
check(Array.isArray(route?.methods) && route.methods.length === 1 && route.methods[0] === 'POST', 'the route accepts POST and nothing else', JSON.stringify(route?.methods));
check(route?.requestBody === 'buffered', 'the route buffers the request body', String(route?.requestBody));
check(fake.module.inject.includes('connection'), 'the bundle injects the connection service', JSON.stringify(fake.module.inject));
check(typeof fake.module.runTool === 'function', 'the child-process runner is exported as a seam');
check(typeof fake.module.runner === 'function' && fake.module.runner === fake.module.runTool, 'the invocation seam is exported under the documented `runner` name');
check(typeof fake.module.apply === 'function', 'the bundle exports apply');

const healthBefore = await command(route, { action: 'health' });
check(healthBefore.status === 200 && healthBefore.payload.ok === true, 'health answers inside the ok envelope', JSON.stringify(healthBefore.payload).slice(0, 120));
check(healthBefore.payload.value?.ready === true, 'health reports ready when config.bin points at an executable', JSON.stringify(healthBefore.payload.value));
check(healthBefore.payload.value?.version === fake.module.TOOL_VERSION, 'health reports the expected tool version', healthBefore.payload.value?.version);
check(healthBefore.payload.value?.bin === join(root, 'fake-bin'), 'health reports the binary it will run', healthBefore.payload.value?.bin);
check(healthBefore.payload.value?.compiled === false, 'a configured bin is never reported as compiled', JSON.stringify(healthBefore.payload.value));

const unknown = await command(route, { action: 'nonsense' });
check(unknown.status === 400 && unknown.payload.error?.code === 'bad-request', 'an unknown action is refused with bad-request', JSON.stringify(unknown.payload));
check((await command(route, { action: 'ocr' })).status === 400, 'an ocr call without base64 is refused');
check((await command(route, { action: 'ocr', base64: '' })).status === 400, 'an empty base64 payload is refused');
check((await command(route, { action: 'ocr', base64: Buffer.from('hello').toString('base64') })).status === 400, 'a payload that is not a PDF is refused');
const oversized = await command(route, { action: 'ocr', base64: 'A'.repeat(fake.module.LIMITS.maxBase64Chars + 4) });
check(oversized.status === 413 && oversized.payload.error?.code === 'too-large', 'an oversized payload is refused with too-large', `${oversized.status}/${oversized.payload.error?.code}`);
const notJson = await route.fetch(new Request('http://127.0.0.1:19387/api/superman-ocr/api', { method: 'POST', body: 'not json' }));
check(notJson.status === 400 && (await notJson.json()).error?.code === 'body', 'a non-JSON body is refused');

check(!existsSync(workDir), 'the work directory does not exist before the first call');

const base64 = pdfBytes.toString('base64');
const first = await command(route, { action: 'ocr', base64, name: '扫描件.pdf' });
check(first.status === 200 && first.payload.ok === true, 'ocr answers inside the ok envelope', JSON.stringify(first.payload).slice(0, 120));
check(first.payload.value?.text.includes('识别结果'), 'ocr returns what the engine printed', JSON.stringify(first.payload.value?.text).slice(0, 60));
check(first.payload.value?.pages === 1, 'ocr counts the page markers', String(first.payload.value?.pages));
check(first.payload.value?.characters === first.payload.value?.text.length, 'ocr reports the character count', `${first.payload.value?.characters}/${first.payload.value?.text.length}`);
check(first.payload.value?.text.includes('--max-pages 40'), 'the row page budget reaches the engine', first.payload.value?.text.split('\n').pop());
check(first.payload.value?.text.includes('--scale 2'), 'the render scale reaches the engine', first.payload.value?.text.split('\n').pop());
check(new RegExp(`ocr-[0-9a-f-]{36}\\.pdf`).test(first.payload.value?.text ?? ''), 'the engine is handed a temporary PDF path');
check(existsSync(workDir), 'the work directory is created on demand');
check(readdirSync(workDir).every((entry) => !entry.endsWith('.pdf')), 'the temporary PDF is deleted after the call', readdirSync(workDir).join(','));

const three = await command(route, { action: 'ocr', base64, maxPages: 3 });
check(three.payload.value?.text.includes('--max-pages 3'), 'a request page budget is passed through', three.payload.value?.text.split('\n').pop());
const clampedHigh = await command(route, { action: 'ocr', base64, maxPages: 10_000 });
check(clampedHigh.payload.value?.text.includes(`--max-pages ${fake.module.LIMITS.hardMaxPages}`), 'a page budget above the ceiling is clamped', clampedHigh.payload.value?.text.split('\n').pop());
const clampedLow = await command(route, { action: 'ocr', base64, maxPages: 0 });
check(clampedLow.payload.value?.text.includes('--max-pages 1'), 'a page budget below one is clamped', clampedLow.payload.value?.text.split('\n').pop());

writeFileSync(state.mode, 'twopage', 'utf8');
const twoPages = await command(route, { action: 'ocr', base64 });
check(twoPages.payload.value?.pages === 2, 'a two-page answer counts two pages', String(twoPages.payload.value?.pages));

writeFileSync(state.mode, 'empty', 'utf8');
const empty = await command(route, { action: 'ocr', base64 });
check(empty.status === 200 && empty.payload.value?.text === '' && empty.payload.value?.characters === 0, 'an empty answer is still a success', JSON.stringify(empty.payload.value));

writeFileSync(state.mode, 'huge', 'utf8');
const huge = await command(route, { action: 'ocr', base64 });
check(huge.payload.value?.text.length === fake.module.LIMITS.maxTextChars, 'long text is capped at the documented limit', String(huge.payload.value?.text.length));
check(huge.payload.value?.characters > fake.module.LIMITS.maxTextChars, 'the reported character count stays the true one', String(huge.payload.value?.characters));

writeFileSync(state.mode, 'fail', 'utf8');
const failed = await command(route, { action: 'ocr', base64 });
check(failed.status === 502 && failed.payload.error?.code === 'ocr-failed', 'a failing engine is an ocr-failed error', `${failed.status}/${failed.payload.error?.code}`);
check(failed.payload.error?.message.includes('could not be rendered'), 'the error carries the engine stderr tail', failed.payload.error?.message);
check(readdirSync(workDir).every((entry) => !entry.endsWith('.pdf')), 'a failed call leaves no temporary PDF behind', readdirSync(workDir).join(','));
writeFileSync(state.mode, 'ok', 'utf8');

const controller = new AbortController();
const abortable = new Request('http://127.0.0.1:19387/api/superman-ocr/api', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ action: 'ocr', base64 }),
	signal: controller.signal,
});
controller.abort();
let aborted = { status: 0, payload: {} };
try {
	const response = await route.fetch(abortable);
	aborted = { status: response.status, payload: await response.json() };
} catch (error) {
	aborted = { status: 0, payload: { error: { code: `threw:${error.name}` } } };
}
check(aborted.payload?.error?.code === 'aborted', 'an aborted request is refused', JSON.stringify(aborted).slice(0, 120));

/* ------------------------------------------------------------------ *
 * Compile on first use (fake swiftc)
 * ------------------------------------------------------------------ */
const compiled = await loadBundle({ bin: '', workDir: buildDir, maxPages: 2, timeoutMs: 30_000, swiftc: join(root, 'fake-swiftc') });
const compiledRoute = compiled.routes.get('/api/superman-ocr/api');
writeFileSync(state.swiftcMode, 'slow', 'utf8');
const beforeCompile = await command(compiledRoute, { action: 'health' });
check(beforeCompile.payload.value?.ready === false && beforeCompile.payload.value?.bin === '', 'health reports not-ready in an empty work directory', JSON.stringify(beforeCompile.payload.value));
check(beforeCompile.payload.value?.compiled === false, 'health reports compiled:false before the first compile', JSON.stringify(beforeCompile.payload.value));

const [concurrentA, concurrentB] = await Promise.all([
	command(compiledRoute, { action: 'ocr', base64 }),
	command(compiledRoute, { action: 'ocr', base64 }),
]);
check(concurrentA.payload.ok === true && concurrentB.payload.ok === true, 'two concurrent calls both succeed', `${concurrentA.status}/${concurrentB.status}`);
check(compileCalls().length === 1, 'concurrent callers share one compile', `${compileCalls().length} swiftc call(s)`);
check(compileCalls()[0]?.includes('-framework Vision') === true && compileCalls()[0]?.includes('-framework PDFKit') === true, 'the compile links Vision and PDFKit', compileCalls()[0]);
check(compileCalls()[0]?.includes(join('tools', 'ocr-pdf.swift')) === true, 'the compile reads the Swift source from the tools directory', compileCalls()[0]);
check(existsSync(join(buildDir, 'ocr-pdf')), 'the compiled binary lands in the work directory');
check(concurrentA.payload.value?.text.includes('识别结果'), 'the compiled binary is the one that runs');
const afterCompile = await command(compiledRoute, { action: 'health' });
check(afterCompile.payload.value?.ready === true, 'health reports ready after the compile', JSON.stringify(afterCompile.payload.value));
check(afterCompile.payload.value?.compiled === true, 'health reports compiled:true once this process built the tool', JSON.stringify(afterCompile.payload.value));
check(afterCompile.payload.value?.version === 'fake-ocr 9.9.9', 'health reports the version the compiled tool prints', afterCompile.payload.value?.version);
await command(compiledRoute, { action: 'ocr', base64 });
check(compileCalls().length === 1, 'a later call does not compile again', `${compileCalls().length} swiftc call(s)`);

const reused = await loadBundle({ bin: '', workDir: buildDir, maxPages: 2, swiftc: join(root, 'fake-swiftc') });
const reusedHealth = await command(reused.routes.get('/api/superman-ocr/api'), { action: 'health' });
check(reusedHealth.payload.value?.ready === true && compileCalls().length === 1, 'a fresh process adopts the cached binary', `${reusedHealth.payload.value?.ready}/${compileCalls().length}`);
check(reusedHealth.payload.value?.compiled === false, 'adopting a cached binary is not counted as a compile', JSON.stringify(reusedHealth.payload.value));

const brokenDir = join(root, 'broken');
const broken = await loadBundle({ bin: '', workDir: brokenDir, swiftc: join(root, 'fake-swiftc') });
writeFileSync(state.swiftcMode, 'fail', 'utf8');
const compileFailed = await command(broken.routes.get('/api/superman-ocr/api'), { action: 'ocr', base64 });
check(compileFailed.status === 500 && compileFailed.payload.error?.code === 'compile-failed', 'a failing swiftc is a compile-failed error', `${compileFailed.status}/${compileFailed.payload.error?.code}`);
check(compileFailed.payload.error?.message.includes("no such module 'Vision'"), 'the compile error carries the stderr tail', compileFailed.payload.error?.message);
check(!existsSync(join(brokenDir, 'ocr-pdf')), 'a failed compile installs no binary');
writeFileSync(state.swiftcMode, 'ok', 'utf8');
const retried = await command(broken.routes.get('/api/superman-ocr/api'), { action: 'ocr', base64 });
check(retried.payload.ok === true && existsSync(join(brokenDir, 'ocr-pdf')), 'a failed compile is retried on the next call', JSON.stringify(retried.payload).slice(0, 120));

const noopDir = join(root, 'noop');
const noop = await loadBundle({ bin: '', workDir: noopDir, swiftc: join(root, 'fake-swiftc') });
writeFileSync(state.swiftcMode, 'noop', 'utf8');
const noOutput = await command(noop.routes.get('/api/superman-ocr/api'), { action: 'ocr', base64 });
check(noOutput.status === 500 && noOutput.payload.error?.code === 'compile-failed', 'a swiftc that produces nothing is reported', `${noOutput.status}/${noOutput.payload.error?.code}`);
writeFileSync(state.swiftcMode, 'ok', 'utf8');

const missingSource = await loadBundle({ bin: '', workDir: join(root, 'missing'), swiftc: join(root, 'fake-swiftc'), source: join(root, 'no-such-tool.swift') });
const missing = await command(missingSource.routes.get('/api/superman-ocr/api'), { action: 'ocr', base64 });
check(missing.status === 500 && missing.payload.error?.code === 'compile-failed' && missing.payload.error?.message.includes('no-such-tool.swift'), 'a missing Swift source is compile-failed', missing.payload.error?.message);

/* ------------------------------------------------------------------ *
 * The exported runner seam
 * ------------------------------------------------------------------ */
const { runTool } = fake.module;
const exitCode = await runTool('/bin/sh', ['-c', 'echo boom >&2; exit 4'], { timeoutMs: 5_000 });
check(exitCode.ok === false && exitCode.code === 4 && exitCode.stderr.includes('boom'), 'the runner reports a non-zero exit with its stderr', JSON.stringify({ code: exitCode.code, stderr: exitCode.stderr.trim() }));
const spawnFail = await runTool(join(root, 'not-a-program'), [], { timeoutMs: 5_000 });
check(spawnFail.ok === false && spawnFail.spawnFailed === true, 'the runner reports an executable that cannot be started', JSON.stringify({ spawnFailed: spawnFail.spawnFailed }));
const timedOut = await runTool('/bin/sh', ['-c', 'sleep 5'], { timeoutMs: 300 });
check(timedOut.ok === false && timedOut.timedOut === true, 'the runner reports a timeout', JSON.stringify({ timedOut: timedOut.timedOut }));

/* ------------------------------------------------------------------ *
 * Bundle conventions
 * ------------------------------------------------------------------ */
const manifest = JSON.parse(execFileSync('/bin/cat', [fileURLToPath(new URL('../superman-ocr/package.json', import.meta.url))], { encoding: 'utf8' }));
check(manifest.name === '@local/dsh-superman-ocr' && manifest.type === 'module', 'the manifest names the package and stays an ES module', `${manifest.name}/${manifest.type}`);
check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'the manifest declares the bundle patch', manifest.dsh?.bundle?.patch);
check(manifest.icon === './icon.svg' && manifest.files?.includes('cordis.patch.yml'), 'the manifest declares its icon and published files', JSON.stringify(manifest.files));
check(manifest.exports?.['./package.json'] === './package.json' && manifest.exports?.['./locale/*.json'] === './locale/*.json', 'the manifest exports package.json and the locales', JSON.stringify(manifest.exports));
const patch = execFileSync('/bin/cat', [fileURLToPath(new URL('../superman-ocr/cordis.patch.yml', import.meta.url))], { encoding: 'utf8' });
check(patch.includes("id: superman-ocr") && patch.includes("'@local/dsh-superman-ocr'"), 'the patch inserts the superman-ocr row', patch.split('\n').find((line) => line.includes('id: superman-ocr')));
check(["bin: ''", "source: ''", "dshHomePath('superman-ocr')", 'maxPages: 40', 'timeoutMs: 600000'].every((line) => patch.includes(line)), 'the patch carries the documented config', patch.split('\n').filter((line) => line.includes('bin:') || line.includes('source:') || line.includes('workDir:')).join(' '));
for (const locale of ['zh', 'en']) {
	const dictionary = JSON.parse(execFileSync('/bin/cat', [fileURLToPath(new URL(`../superman-ocr/locale/${locale}.json`, import.meta.url))], { encoding: 'utf8' }));
	check(typeof dictionary.meta?.title === 'string' && typeof dictionary.meta?.description === 'string' && dictionary.meta.title !== '' && dictionary.meta.description !== '', `the ${locale} locale carries a title and a description`);
}

/* ------------------------------------------------------------------ *
 * End to end: compile the real tool and read a generated PDF page
 * ------------------------------------------------------------------ */
/** A one-page PDF with a Helvetica text line, built by hand. */
function textPdf(line) {
	const stream = `BT /F1 40 Tf 72 640 Td (${line}) Tj ET`;
	const objects = [
		'<</Type/Catalog/Pages 2 0 R>>',
		'<</Type/Pages/Kids[3 0 R]/Count 1>>',
		'<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
		`<</Length ${Buffer.byteLength(stream)}>>\nstream\n${stream}\nendstream`,
		'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
	];
	let pdf = '%PDF-1.4\n';
	const offsets = [];
	objects.forEach((body, index) => {
		offsets.push(Buffer.byteLength(pdf, 'latin1'));
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});
	const startxref = Buffer.byteLength(pdf, 'latin1');
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
	return Buffer.from(pdf, 'latin1');
}

const hasSwiftc = (() => {
	try {
		execFileSync('/usr/bin/which', ['swiftc'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

if (process.env.DSH_OCR_E2E !== '1') {
	console.log('  --  (skipping the end-to-end OCR run; set DSH_OCR_E2E=1 to compile and run the real tool)');
} else if (!hasSwiftc) {
	console.log('  --  (swiftc is not on PATH; skipping the end-to-end OCR run)');
} else {
	const e2eDir = join(root, 'e2e');
	const e2e = await loadBundle({ bin: '', workDir: e2eDir, timeoutMs: 300_000 });
	const e2eRoute = e2e.routes.get('/api/superman-ocr/api');
	const page = textPdf('OCR CHECK PAGE ONE');
	const result = await command(e2eRoute, { action: 'ocr', base64: page.toString('base64'), name: 'generated.pdf' });
	check(result.payload.ok === true, 'the real tool compiles and answers', JSON.stringify(result.payload).slice(0, 200));
	check(result.payload.value?.pages === 1, 'the real tool reads exactly one page', String(result.payload.value?.pages));
	check(/ocr/i.test(result.payload.value?.text ?? ''), 'the real tool recognises the generated text', String(result.payload.value?.characters));
	const e2eHealth = await command(e2eRoute, { action: 'health' });
	check(e2eHealth.payload.value?.ready === true && String(e2eHealth.payload.value?.version).startsWith('ocr-pdf'), 'health reports the compiled real tool', JSON.stringify(e2eHealth.payload.value));
	check(e2eHealth.payload.value?.compiled === true, 'the real compile is reported as compiled', JSON.stringify(e2eHealth.payload.value));
}

await rm(root, { recursive: true, force: true });
check(!existsSync(root), 'the temporary work directory is cleaned up');

console.log('');
if (failures.length > 0) {
	console.log(`${failures.length} check(s) failed`);
	for (const failure of failures) console.log(` - ${failure}`);
	process.exit(1);
}
console.log('all checks passed');

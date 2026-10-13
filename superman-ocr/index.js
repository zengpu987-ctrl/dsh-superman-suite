/**
 * Host half of the Superman OCR bundle.
 *
 * Scanned PDFs — and PDFs whose text has been turned into outlines — carry no
 * usable text layer, so the Superman memory can only keep their bytes: the
 * browser-side PDF reader answers `{ text: '', note: 'no-text' }` and there is
 * nothing to recall. macOS already ships a good Chinese/English OCR engine
 * (Vision), so this half exposes it as one route on the authenticated `/api`
 * channel:
 *
 *   POST /api/superman-ocr/api   — health / ocr
 *
 * The engine itself is the self-contained Swift program in
 * `tools/ocr-pdf.swift` (PDFKit renders each page, Vision recognises the
 * bitmap). It is compiled with `swiftc` **on first use** into the plugin's
 * `workDir`, exactly once per process, and the finished binary is cached there
 * so later runs — and later processes — reuse it.
 *
 * Everything that shells out goes through the exported `runTool` seam, and the
 * binary itself can be replaced with `config.bin`, so `tools/superman-ocr-check.mjs`
 * can drive the whole route offline with a fake executable. See `API.md` for
 * the frozen browser contract.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, existsSync, statSync } from 'node:fs';
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Services this bundle needs before it activates. */
export const inject = ['connection'];

/** Version this half expects from the Swift tool; `--version` may override it. */
export const TOOL_VERSION = 'ocr-pdf 1.0.0';

/** The exact route the browser half calls, under the authenticated `/api` channel. */
const ROUTE_PATH = '/api/superman-ocr/api';

/** Default page budget when neither the row nor the request names one. */
const DEFAULT_MAX_PAGES = 40;
/** Hard ceiling for one OCR call, whatever a caller asks for. */
const HARD_MAX_PAGES = 200;
/** Default wall-clock budget for one OCR call. */
const DEFAULT_TIMEOUT_MS = 600_000;
/** Wall-clock budget for the one-off `swiftc` compile. */
const COMPILE_TIMEOUT_MS = 300_000;
/** Rendering scale, in device pixels per PDF point. */
const DEFAULT_SCALE = 2;
/** Smallest and largest accepted render scale. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
/** Longest PDF accepted, in bytes. */
const MAX_PDF_BYTES = 32 * 1024 * 1024;
/** Base64 form of {@link MAX_PDF_BYTES}, plus room for the JSON around it. */
const MAX_BASE64_CHARS = Math.ceil(MAX_PDF_BYTES / 3) * 4 + 8;
/** Longest text returned to the browser, in characters. */
const MAX_TEXT_CHARS = 400_000;
/** Longest stdout/stderr kept from a child process. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** How much of a failing child's stderr travels in the error message. */
const STDERR_TAIL_CHARS = 1200;
/** Frameworks the Swift tool links against. */
const SWIFT_FRAMEWORKS = ['-framework', 'Vision', '-framework', 'PDFKit', '-framework', 'AppKit'];

/**
 * The limits and paths this bundle publishes, so callers and the offline check
 * agree with the implementation instead of repeating magic numbers.
 */
export const LIMITS = Object.freeze({
	routePath: ROUTE_PATH,
	defaultMaxPages: DEFAULT_MAX_PAGES,
	hardMaxPages: HARD_MAX_PAGES,
	defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
	defaultScale: DEFAULT_SCALE,
	maxPdfBytes: MAX_PDF_BYTES,
	maxBase64Chars: MAX_BASE64_CHARS,
	maxTextChars: MAX_TEXT_CHARS,
});

/** One JSON failure the browser words in its own language. */
function failure(status, code, message) {
	return Response.json({ ok: false, error: { code, message } }, { status });
}

/** An error carrying the stable machine code the route maps to a status. */
function problem(code, message) {
	return Object.assign(new Error(message), { code });
}

/** HTTP status for one stable error code. */
function statusOf(code) {
	if (code === 'bad-request') return 400;
	if (code === 'too-large') return 413;
	if (code === 'aborted') return 499;
	if (code === 'ocr-timeout') return 504;
	if (code === 'ocr-failed') return 502;
	return 500;
}

/** The last `STDERR_TAIL_CHARS` characters of a child's diagnostics. */
function tail(text) {
	const trimmed = String(text ?? '').trim();
	return trimmed.length <= STDERR_TAIL_CHARS ? trimmed : `…${trimmed.slice(-STDERR_TAIL_CHARS)}`;
}

/** A finite number inside a range, or the fallback. */
function bounded(value, fallback, minimum, maximum) {
	const number = Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(maximum, Math.max(minimum, number));
}

/** Whether a path is a file this process may execute. */
function isExecutable(path) {
	if (path === '' || !existsSync(path)) return false;
	try {
		access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Run one child process to completion.
 *
 * This is the single seam between the route and the outside world: a caller can
 * replace it through `config.runner` and hand back a scripted result instead.
 *
 * @param executable - the program to run.
 * @param args - its arguments.
 * @param options - `timeoutMs`, `cwd`, `env`, `maxBuffer`, and an `AbortSignal`.
 * @returns the exit state and the captured streams; never rejects.
 */
export function runTool(executable, args, options = {}) {
	const signal = options.signal;
	return new Promise((resolve) => {
		const decide = (error, stdout, stderr) => {
			const aborted = signal?.aborted === true;
			const ok = error === null || error === undefined;
			resolve({
				ok,
				code: ok ? 0 : typeof error.code === 'number' ? error.code : error.code ?? 1,
				stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
				stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
				message: ok ? '' : String(error.message ?? error),
				timedOut: !ok && !aborted && error.killed === true,
				aborted,
				spawnFailed: !ok && typeof error.code === 'string' && error.killed !== true,
			});
		};
		try {
			execFile(executable, args, {
				timeout: Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS,
				maxBuffer: options.maxBuffer ?? MAX_OUTPUT_BYTES,
				killSignal: 'SIGKILL',
				...(options.cwd === undefined ? {} : { cwd: options.cwd }),
				env: options.env ?? process.env,
				...(signal === undefined ? {} : { signal }),
			}, decide);
		} catch (error) {
			decide(error, '', '');
		}
	});
}

/** The same invocation seam under the name the frozen bundle contract documents. */
export const runner = runTool;

/**
 * Register the OCR route.
 * @param ctx - the Host plugin context.
 * @param config - the Loader row's configuration.
 */
export function apply(ctx, config) {
	const workDir = String(config?.workDir ?? '').trim() || join(tmpdir(), 'dsh-superman-ocr');
	const configuredBin = String(config?.bin ?? '').trim();
	/** The Swift program to compile, resolved from this package unless configured. */
	const sourcePath = String(config?.source ?? '').trim()
		|| fileURLToPath(new URL('../tools/ocr-pdf.swift', import.meta.url));
	const compiler = String(config?.swiftc ?? '').trim() || 'swiftc';
	const defaultMaxPages = Math.round(bounded(config?.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES));
	const timeoutMs = Math.round(bounded(config?.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 3_600_000));
	const scale = bounded(config?.scale, DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
	const runner = typeof config?.runner === 'function' ? config.runner : runTool;

	/** The compiled binary, once this process has built (or adopted) one. */
	let compiledBin = '';
	/** Whether *this* process ran `swiftc`; a binary adopted from the cache does not count. */
	let compiledHere = false;
	/** The version the compiled binary reported, when it reported one. */
	let reportedVersion = '';
	/** The in-flight compile; every concurrent caller awaits this one promise. */
	let compiling = null;

	/** Where the compile writes its output. */
	const compiledPath = join(workDir, 'ocr-pdf');

	/** The binary an earlier process left behind, when it is still current. */
	function cachedBinary() {
		if (!isExecutable(compiledPath)) return '';
		try {
			if (existsSync(sourcePath) && statSync(sourcePath).mtimeMs > statSync(compiledPath).mtimeMs) return '';
		} catch {
			/* an unreadable timestamp still leaves a usable binary */
		}
		return compiledPath;
	}

	/** The binary this bundle would run right now, or '' when there is none yet. */
	function resolvedBin() {
		if (configuredBin !== '') return configuredBin;
		if (compiledBin !== '') return compiledBin;
		return cachedBinary();
	}

	/** Ask the compiled tool for its version; the answer is cosmetic. */
	async function probeVersion(binary) {
		try {
			const result = await runner(binary, ['--version'], { timeoutMs: 15_000, cwd: workDir });
			if (!result.ok) return;
			const first = result.stdout.split('\n').map((line) => line.trim()).find((line) => line !== '');
			if (first !== undefined) reportedVersion = first;
		} catch {
			/* a tool without --version simply keeps the expected version */
		}
	}

	/**
	 * Compile the Swift tool into `workDir`, once per process.
	 * @returns the path of the binary to run.
	 */
	async function compile() {
		const cached = cachedBinary();
		if (cached !== '') {
			compiledBin = cached;
			await probeVersion(cached);
			return cached;
		}
		if (!existsSync(sourcePath)) {
			throw problem('compile-failed', `the OCR source is missing: ${sourcePath}`);
		}
		await mkdir(workDir, { recursive: true });
		const staging = `${compiledPath}.building`;
		await rm(staging, { force: true }).catch(() => {});
		const result = await runner(compiler, ['-O', sourcePath, '-o', staging, ...SWIFT_FRAMEWORKS], {
			timeoutMs: COMPILE_TIMEOUT_MS,
			cwd: workDir,
			/* A sandboxed profile may not be able to write clang's default module
			   cache; keeping it inside workDir makes the build self-contained. */
			env: {
				...process.env,
				CLANG_MODULE_CACHE_PATH: join(workDir, 'clang-cache'),
				SWIFT_MODULECACHE_PATH: join(workDir, 'clang-cache'),
			},
		});
		if (result.timedOut) {
			await rm(staging, { force: true }).catch(() => {});
			throw problem('compile-failed', `swiftc timed out after ${COMPILE_TIMEOUT_MS} ms`);
		}
		if (!result.ok) {
			await rm(staging, { force: true }).catch(() => {});
			const detail = tail(result.stderr) || tail(result.message);
			throw problem('compile-failed', `swiftc failed (${result.spawnFailed ? 'not runnable' : `exit ${result.code}`})${detail === '' ? '' : `: ${detail}`}`);
		}
		if (!existsSync(staging)) {
			throw problem('compile-failed', `swiftc reported success but produced no binary at ${staging}`);
		}
		try {
			await rename(staging, compiledPath);
			await chmod(compiledPath, 0o755);
		} catch (error) {
			await rm(staging, { force: true }).catch(() => {});
			throw problem('compile-failed', `the compiled binary could not be installed: ${error instanceof Error ? error.message : String(error)}`);
		}
		compiledHere = true;
		compiledBin = compiledPath;
		await probeVersion(compiledPath);
		return compiledPath;
	}

	/** The binary to run, compiling the tool at most once across all callers. */
	async function ensureBinary() {
		if (configuredBin !== '') return configuredBin;
		if (compiledBin !== '') return compiledBin;
		if (compiling === null) {
			compiling = compile().catch((error) => {
				compiling = null;
				throw error;
			});
		}
		return compiling;
	}

	/** What the browser half can rely on right now. */
	function health() {
		const bin = resolvedBin();
		return {
			ready: isExecutable(bin),
			bin,
			compiled: compiledHere,
			version: reportedVersion === '' ? TOOL_VERSION : reportedVersion,
		};
	}

	/** One OCR call: bytes in, recognised text out. */
	async function ocr(body, signal) {
		if (typeof body?.base64 !== 'string' || body.base64.trim() === '') {
			throw problem('bad-request', 'base64 is required');
		}
		if (body.base64.length > MAX_BASE64_CHARS) {
			throw problem('too-large', `the payload is larger than ${MAX_PDF_BYTES} bytes`);
		}
		const bytes = Buffer.from(body.base64, 'base64');
		if (bytes.length === 0) throw problem('bad-request', 'the payload is empty');
		if (bytes.length > MAX_PDF_BYTES) {
			throw problem('too-large', `the payload is larger than ${MAX_PDF_BYTES} bytes`);
		}
		if (!bytes.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
			throw problem('bad-request', 'the payload is not a PDF');
		}
		if (signal?.aborted === true) throw problem('aborted', 'the request was aborted');
		const pages = Math.round(bounded(body.maxPages, defaultMaxPages, 1, HARD_MAX_PAGES));
		const bin = await ensureBinary();
		if (signal?.aborted === true) throw problem('aborted', 'the request was aborted');
		await mkdir(workDir, { recursive: true });
		const temporary = join(workDir, `ocr-${randomUUID()}.pdf`);
		await writeFile(temporary, bytes);
		try {
			const result = await runner(bin, [temporary, '--max-pages', String(pages), '--scale', String(scale)], {
				timeoutMs,
				cwd: workDir,
				signal,
			});
			if (result.aborted || signal?.aborted === true) throw problem('aborted', 'the request was aborted');
			if (result.timedOut) throw problem('ocr-timeout', `the OCR engine did not finish within ${timeoutMs} ms`);
			if (!result.ok) {
				const detail = tail(result.stderr) || tail(result.message);
				throw problem('ocr-failed', `the OCR engine failed (${result.spawnFailed ? 'not runnable' : `exit ${result.code}`})${detail === '' ? '' : `: ${detail}`}`);
			}
			const raw = result.stdout;
			return {
				text: raw.length > MAX_TEXT_CHARS ? raw.slice(0, MAX_TEXT_CHARS) : raw,
				pages: (raw.match(/^## page \d+/gm) ?? []).length,
				characters: raw.length,
			};
		} finally {
			await rm(temporary, { force: true }).catch(() => {});
		}
	}

	/** Answer one `/api/superman-ocr/api` command. */
	async function command(body, signal) {
		const action = String(body?.action ?? '');
		if (action === 'health') return health();
		if (action === 'ocr') return ocr(body, signal);
		throw problem('bad-request', `unknown action: ${action}`);
	}

	ctx.inject(['connection'], (connectionCtx) => {
		connectionCtx.effect(() => connectionCtx.connection.fetch.register({
			path: ROUTE_PATH,
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
					return Response.json({ ok: true, value: await command(body, request.signal) });
				} catch (error) {
					const code = error?.code ?? 'internal';
					return failure(statusOf(code), code, error instanceof Error ? error.message : String(error));
				}
			},
		}), 'superman-ocr: command route');
	});
}

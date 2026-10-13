/**
 * Host half of the arXiv bundle.
 *
 * The browser cannot call the arXiv API directly — `export.arxiv.org` answers
 * without an `Access-Control-Allow-Origin` header, so a page fetch is blocked.
 * This half registers one same-origin route, `/arxiv/search`, that validates the
 * request, applies arXiv's own one-request-per-three-seconds guidance, queries
 * the public Atom API, and passes its feed through unchanged. The settings page
 * then parses that feed with the renderer's own XML parser.
 *
 * The route is deliberately narrow: callers choose a search mode and a query,
 * never a URL, so it cannot be turned into a general proxy.
 */
/** The path the settings page calls, relative to the Web GUI's origin. */
const ROUTE_PATH = '/arxiv/search';
/** arXiv's public query endpoint. */
const UPSTREAM_URL = 'https://export.arxiv.org/api/query';
/** How many results one search may ask for; arXiv's own ceiling for a single page. */
const MAX_RESULTS = 50;
/** Longest accepted query, so a pasted document cannot become one search term. */
const MAX_QUERY_LENGTH = 300;
/** arXiv query-language field prefixes, one per search mode the page offers. */
const SEARCH_FIELDS = { all: 'all', title: 'ti', author: 'au', abstract: 'abs', category: 'cat' };
/** Sort names the page offers, mapped onto arXiv's own `sortBy` values. */
const SORT_FIELDS = { relevance: 'relevance', submitted: 'submittedDate', updated: 'lastUpdatedDate' };

/** Write one plain response. */
function respond(res, status, type, body) {
	res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
	res.end(body);
}
/** Report a failure as JSON the page can word in its own language. */
function fail(res, status, code, detail) {
	respond(
		res,
		status,
		'application/json; charset=utf-8',
		JSON.stringify({ error: detail === undefined ? { code } : { code, detail } }),
	);
}
/** Clamp the requested page size into what the endpoint accepts. */
function pageSize(raw) {
	const value = Number(raw);
	if (!Number.isFinite(value)) return 20;
	return Math.min(MAX_RESULTS, Math.max(1, Math.trunc(value)));
}
/**
 * Build the upstream query string for one search.
 * @param mode - `all`, `title`, `author`, `abstract`, `category`, or `id`.
 * @param query - what the person typed, already trimmed.
 * @returns the arXiv query parameters, without paging and sorting.
 */
function upstreamQuery(mode, query) {
	const params = new URLSearchParams();
	if (mode === 'id') {
		// One id or a comma-separated list; the `arXiv:` prefix is optional.
		params.set('id_list', query.replace(/arxiv:/gi, '').replace(/\s+/g, ''));
		return params;
	}
	const field = SEARCH_FIELDS[mode] ?? SEARCH_FIELDS.all;
	const term = query.replace(/"/g, '');
	params.set('search_query', mode === 'category' ? `cat:${term}` : `${field}:"${term}"`);
	return params;
}
/**
 * Register the arXiv search route.
 * @param ctx - the Host plugin context.
 * @param config - the Loader row's configuration.
 */
export function apply(ctx, config) {
	const minIntervalMs = Math.max(0, Number(config?.minIntervalMs ?? 3000));
	const timeoutMs = Math.max(1000, Number(config?.requestTimeoutMs ?? 20000));
	/** When the last upstream request started, so the next one can respect arXiv's pacing. */
	let lastRequestAt = 0;
	/**
	 * Serve one search request.
	 * @param req - the raw HTTP request from the Web server.
	 * @param res - the raw HTTP response.
	 */
	async function serve(req, res) {
		if (req.method !== 'GET') {
			fail(res, 405, 'method');
			return;
		}
		const url = new URL(req.url ?? ROUTE_PATH, 'http://127.0.0.1');
		const mode = url.searchParams.get('mode') ?? 'all';
		const query = (url.searchParams.get('q') ?? '').trim();
		if (query === '') {
			fail(res, 400, 'empty');
			return;
		}
		if (query.length > MAX_QUERY_LENGTH) {
			fail(res, 400, 'too-long');
			return;
		}
		if (mode !== 'id' && SEARCH_FIELDS[mode] === undefined) {
			fail(res, 400, 'mode', mode);
			return;
		}
		if (mode === 'id' && !/\d/.test(query)) {
			fail(res, 400, 'empty-id');
			return;
		}
		const params = upstreamQuery(mode, query);
		params.set('start', '0');
		params.set('max_results', String(pageSize(url.searchParams.get('max'))));
		if (mode !== 'id') {
			params.set('sortBy', SORT_FIELDS[url.searchParams.get('sort') ?? ''] ?? SORT_FIELDS.relevance);
			params.set('sortOrder', 'descending');
		}
		const wait = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		lastRequestAt = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(`${UPSTREAM_URL}?${params.toString()}`, {
				headers: { accept: 'application/atom+xml', 'user-agent': 'dsh-arxiv-plugin/0.1' },
				signal: controller.signal,
			});
			const body = await response.text();
			if (!response.ok) {
				fail(res, 502, 'upstream', String(response.status));
				return;
			}
			respond(res, 200, 'application/atom+xml; charset=utf-8', body);
		} catch (error) {
			fail(res, 502, 'network', String(error?.message ?? error));
		} finally {
			clearTimeout(timer);
		}
	}
	ctx.inject(['webServer'], (webCtx) => {
		webCtx.effect(
			() => webCtx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler: serve }),
			'arxiv-search: search route',
		);
	});
}

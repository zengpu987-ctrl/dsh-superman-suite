/**
 * Browser half of the arXiv bundle: the Settings section that searches arXiv
 * and lists what it returns.
 *
 * The page never calls `export.arxiv.org` directly — that endpoint answers
 * without a CORS header — it calls the same-origin route the Host half
 * registers, then parses the Atom feed with the renderer's own `DOMParser`.
 * Only React from the boot module table and theme tokens are used, so the page
 * follows the app's language and both themes.
 */
window.__ModuleLoader__.load({
	id: '@local/dsh-arxiv',
	factory: (require) => {
		const React = require('react');
		const PKG = '@local/dsh-arxiv';
		/** Dictionary namespace owned by this plugin. */
		const NS = 'arxivSearch';
		/** The Settings navigation entry this plugin contributes. */
		const SECTION_ID = 'arxiv';
		/** The same-origin route the Host half registers, relative to the page origin. */
		const ROUTE = 'arxiv/search';
		/** Required services (cordis fiber inject). */
		const inject = ['slots', 'locale'];
		/** Search modes, in the order the panel offers them. */
		const MODES = ['all', 'title', 'author', 'abstract', 'id', 'category'];
		/** How many results one page may ask for. */
		const SIZES = ['10', '20', '50'];
		/** Sort orders; arXiv ignores the sort for an id lookup. */
		const SORTS = ['relevance', 'submitted', 'updated'];

		//#region styles
		const css = [
			'.ax_section{max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}',
			'.ax_heading{margin:0;font-size:18px;font-weight:600}',
			'.ax_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}',
			'.ax_form{flex-wrap:wrap;align-items:flex-end;gap:10px;display:flex}',
			'.ax_field{flex-direction:column;gap:4px;display:flex;min-width:0}',
			'.ax_grow{flex:1;min-width:220px}',
			'.ax_label{color:var(--dsw-alias-label-caption);font-size:12px;line-height:16px}',
			'.ax_input,.ax_select{box-sizing:border-box;height:32px;padding:0 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);font:inherit;font-size:13px}',
			'.ax_input::placeholder{color:var(--dsw-alias-label-caption)}',
			'.ax_input:focus-visible,.ax_select:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
			'.ax_btn{height:32px;padding:0 14px;border-radius:var(--dsw-radius-lg);border:.5px solid transparent;font:inherit;font-size:13px;line-height:20px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill)}',
			'.ax_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.ax_btn[disabled]{cursor:default;opacity:.45}',
			'.ax_btn[disabled]:hover{background:var(--dsw-alias-button-ghost-active-fill)}',
			'.ax_btnPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}',
			'.ax_btnPrimary:hover{background:var(--dsw-alias-button-primary-hover)}',
			'.ax_btnPrimary[disabled]:hover{background:var(--dsw-alias-button-primary-fill)}',
			'.ax_btn:focus-visible,.ax_link:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
			'.ax_examples{align-items:center;flex-wrap:wrap;gap:8px;display:flex}',
			'.ax_examplesLabel{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}',
			'.ax_chip{color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);background:0 0;border-radius:999px;padding:2px 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
			'.ax_chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.ax_chip:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
			'.ax_hint{color:var(--dsw-alias-label-caption);margin:0;font-size:12px;line-height:18px}',
			'.ax_status{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}',
			'.ax_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex;font-size:13px;line-height:20px}',
			'.ax_summary{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
			'.ax_list{flex-direction:column;gap:10px;margin:0;padding:0;list-style:none;display:flex}',
			'.ax_card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill,transparent);flex-direction:column;gap:6px;padding:12px 14px;display:flex}',
			'.ax_title{color:var(--dsw-alias-link);font-size:14px;font-weight:500;line-height:20px;text-decoration:none}',
			'.ax_title:hover{text-decoration:underline}',
			'.ax_meta{color:var(--dsw-alias-label-caption);flex-wrap:wrap;gap:10px;font-size:12px;line-height:18px;display:flex}',
			'.ax_venue{color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px}',
			'.ax_abstract{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
			'.ax_clamp{-webkit-line-clamp:3;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}',
			'.ax_actions{align-items:center;flex-wrap:wrap;gap:12px;display:flex}',
			'.ax_saved{color:var(--dsw-alias-state-success-primary)}',
			'.ax_failed{color:var(--dsw-alias-state-error-primary)}',
			'.ax_link{color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;background:0 0;border:0;padding:0;text-decoration:none}',
			'.ax_link:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}',
			'.ax_copied{color:var(--dsw-alias-state-success-primary)}',
		].join('');
		//#endregion

		//#region locales
		const zh = {
			nav: 'arXiv 文献',
			title: 'arXiv 文献检索',
			intro: '按 arXiv 号、标题、作者、摘要、关键词或分类检索 arXiv 上的论文；结果中的「会议 / 期刊」取自 arXiv 记录的 comment 与 journal-ref。',
			modeLabel: '检索字段',
			modeAll: '关键词',
			modeTitle: '标题',
			modeAuthor: '作者',
			modeAbstract: '摘要',
			modeId: 'arXiv 号',
			modeCategory: '分类',
			queryLabel: '检索内容',
			placeholderAll: '例：retrieval augmented generation',
			placeholderTitle: '例：Attention Is All You Need',
			placeholderAuthor: '例：Ashish Vaswani',
			placeholderAbstract: '例：sparse attention',
			placeholderId: '例：2303.08774 或 2303.08774, 1706.03762',
			placeholderCategory: '例：cs.CL 或 cs.AI',
			sizeLabel: '每页条数',
			sortLabel: '排序',
			sortRelevance: '相关度',
			sortSubmitted: '最新提交',
			sortUpdated: '最近更新',
			search: '检索',
			searching: '正在检索 arXiv…',
			examples: '试试',
			hint: 'arXiv 官方接口限速：每个客户端约 3 秒 1 次请求，本插件已在 Host 侧排队等待。',
			total: '共',
			papers: '篇（显示',
			shownEnd: '）',
			empty: '没有找到匹配的论文，换个关键词或检索字段再试。',
			errEmpty: '请输入要检索的内容。',
			errEmptyId: 'arXiv 号里没有数字，请检查输入。',
			errTooLong: '检索内容过长，请缩短到 300 字符以内。',
			errMode: '不支持的检索字段。',
			errMethod: '请求方式不被支持。',
			errUpstream: 'arXiv 接口返回错误',
			errNetwork: '请求 arXiv 失败',
			errParse: '解析 arXiv 返回的内容失败',
			retry: '重试',
			venue: '会议 / 期刊',
			journal: '期刊',
			authors: '作者',
			published: '提交',
			updatedLabel: '更新',
			primary: '主分类',
			expand: '展开摘要',
			collapse: '收起摘要',
			pdf: 'PDF',
			favorite: '收藏到记忆体',
			favoriteHint: '把这篇论文归档到 Superman 记忆体',
			favoriting: '归档中…',
			favorited: '已归档 PDF',
			favoritedNote: '已归档为记录',
			favoriteFailed: '归档失败',
			abs: '摘要页',
			copyBibtex: '复制 BibTeX',
			copied: '已复制',
			copyFailed: '复制失败，请手动选择',
		};
		const en = {
			nav: 'arXiv search',
			title: 'arXiv search',
			intro: 'Search arXiv by id, title, author, abstract, keyword or category; the venue line comes from the comment and journal-ref arXiv records.',
			modeLabel: 'Field',
			modeAll: 'Keyword',
			modeTitle: 'Title',
			modeAuthor: 'Author',
			modeAbstract: 'Abstract',
			modeId: 'arXiv id',
			modeCategory: 'Category',
			queryLabel: 'Query',
			placeholderAll: 'e.g. retrieval augmented generation',
			placeholderTitle: 'e.g. Attention Is All You Need',
			placeholderAuthor: 'e.g. Ashish Vaswani',
			placeholderAbstract: 'e.g. sparse attention',
			placeholderId: 'e.g. 2303.08774 or 2303.08774, 1706.03762',
			placeholderCategory: 'e.g. cs.CL or cs.AI',
			sizeLabel: 'Per page',
			sortLabel: 'Sort',
			sortRelevance: 'Relevance',
			sortSubmitted: 'Newest',
			sortUpdated: 'Recently updated',
			search: 'Search',
			searching: 'Searching arXiv…',
			examples: 'Try',
			hint: "arXiv's own guidance is one request per client every three seconds; this plugin queues on the Host side.",
			total: 'About',
			papers: 'results (showing',
			shownEnd: ')',
			empty: 'No paper matches this query; try another keyword or field.',
			errEmpty: 'Type something to search for.',
			errEmptyId: 'That arXiv id carries no digits; check the input.',
			errTooLong: 'The query is too long; keep it under 300 characters.',
			errMode: 'That search field is not supported.',
			errMethod: 'That request method is not supported.',
			errUpstream: 'The arXiv endpoint answered with an error',
			errNetwork: 'The request to arXiv failed',
			errParse: 'The answer from arXiv could not be parsed',
			retry: 'Retry',
			venue: 'Venue',
			journal: 'Journal',
			authors: 'Authors',
			published: 'Submitted',
			updatedLabel: 'Updated',
			primary: 'Primary',
			expand: 'Show abstract',
			collapse: 'Hide abstract',
			pdf: 'PDF',
			favorite: 'Save to memory',
			favoriteHint: 'Archive this paper into the Superman memory',
			favoriting: 'Archiving…',
			favorited: 'PDF archived',
			favoritedNote: 'Archived as a record',
			favoriteFailed: 'Archive failed',
			abs: 'Abstract page',
			copyBibtex: 'Copy BibTeX',
			copied: 'Copied',
			copyFailed: 'Copy failed; select the text manually',
		};
		//#endregion

		//#region feed parsing
		/** Collapse the whitespace arXiv hard-wraps in titles and abstracts. */
		function text(node) {
			return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
		}
		/** The arXiv id without its version suffix, as a citation key uses it. */
		function bareId(value) {
			const match = /\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}/i.exec(value ?? '');
			return match === null ? (value ?? '').trim() : match[0];
		}
		/**
		 * Read one Atom feed into the fields the panel renders.
		 * @param source - the feed text returned by the Host route.
		 * @returns the total result count and the parsed entries.
		 * @throws an error whose `code` is `parse` when the body is not an Atom feed.
		 */
		function parseFeed(source) {
			const doc = new DOMParser().parseFromString(source, 'application/xml');
			if (doc.getElementsByTagName('parsererror').length > 0) {
				const error = new Error('arxiv feed parse failed');
				error.code = 'parse';
				throw error;
			}
			const totalText = doc.getElementsByTagName('opensearch:totalResults')[0]?.textContent;
			const total = Number.parseInt(totalText ?? '0', 10);
			const entries = [...doc.getElementsByTagName('entry')].map((entry) => {
				const value = (tag) => text(entry.getElementsByTagName(tag)[0]);
				const links = [...entry.getElementsByTagName('link')];
				const href = (predicate) => links.find(predicate)?.getAttribute('href') ?? undefined;
				return {
					id: value('id'),
					title: value('title'),
					summary: value('summary'),
					published: value('published').slice(0, 10),
					updated: value('updated').slice(0, 10),
					authors: [...entry.getElementsByTagName('author')].map((author) => text(author.getElementsByTagName('name')[0])).filter(Boolean),
					primary: entry.getElementsByTagName('arxiv:primary_category')[0]?.getAttribute('term') ?? '',
					comment: value('arxiv:comment'),
					journalRef: value('arxiv:journal_ref'),
					abs: href((link) => link.getAttribute('rel') === 'alternate') ?? value('id'),
					pdf: href((link) => link.getAttribute('title') === 'pdf'),
				};
			});
			// A malformed query comes back as one entry titled "Error".
			if (entries.length === 1 && entries[0].title === 'Error') {
				const error = new Error(entries[0].summary);
				error.code = 'upstream';
				error.detail = entries[0].summary;
				throw error;
			}
			return { total: Number.isFinite(total) ? total : entries.length, entries };
		}
		/** One `@misc` BibTeX entry for a paper the feed described. */
		function bibtexOf(item) {
			const key = bareId(item.id);
			const first = (item.authors[0] ?? 'arxiv').split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '') || 'arxiv';
			const year = (item.published || '').slice(0, 4);
			const fields = [
				`  title={${item.title}}`,
				`  author={${item.authors.join(' and ')}}`,
				`  year={${year}}`,
				`  eprint={${key}}`,
				'  archivePrefix={arXiv}',
				item.primary === '' ? undefined : `  primaryClass={${item.primary}}`,
				item.journalRef === '' ? undefined : `  journal={${item.journalRef}}`,
				item.comment === '' ? undefined : `  note={${item.comment}}`,
				`  url={${item.abs}}`,
			].filter((line) => line !== undefined);
			return `@misc{${first}${year}${key.replace(/[^a-zA-Z0-9]/g, '')},\n${fields.join(',\n')}\n}`;
		}
		/** Copy text to the clipboard, reporting whether it worked. */
		async function copyText(value) {
			try {
				if (navigator.clipboard?.writeText !== undefined) {
					await navigator.clipboard.writeText(value);
					return true;
				}
			} catch {
				/* fall through to the selection route */
			}
			try {
				const area = document.createElement('textarea');
				area.value = value;
				area.style.position = 'fixed';
				area.style.opacity = '0';
				document.body.appendChild(area);
				area.select();
				const copied = document.execCommand('copy');
				area.remove();
				return copied;
			} catch {
				return false;
			}
		}
		//#endregion

		//#region panel
		/** Whether a search mode takes an arXiv id instead of a query field. */
		const isIdMode = (mode) => mode === 'id';
		/** The placeholder key for one mode. */
		const placeholderKey = (mode) =>
			mode === 'title'
				? 'placeholderTitle'
				: mode === 'author'
					? 'placeholderAuthor'
					: mode === 'abstract'
						? 'placeholderAbstract'
						: isIdMode(mode)
							? 'placeholderId'
							: mode === 'category'
								? 'placeholderCategory'
								: 'placeholderAll';
		/** The mode label key for one mode. */
		const modeKey = (mode) =>
			mode === 'title'
				? 'modeTitle'
				: mode === 'author'
					? 'modeAuthor'
					: mode === 'abstract'
						? 'modeAbstract'
						: isIdMode(mode)
							? 'modeId'
							: mode === 'category'
								? 'modeCategory'
								: 'modeAll';
		/** The sort label key for one sort. */
		const sortKey = (sort) => (sort === 'submitted' ? 'sortSubmitted' : sort === 'updated' ? 'sortUpdated' : 'sortRelevance');
		/** The notice the panel shows for one failure. */
		const failureKey = (code) =>
			code === 'empty'
				? 'errEmpty'
				: code === 'empty-id'
					? 'errEmptyId'
					: code === 'too-long'
						? 'errTooLong'
						: code === 'mode'
							? 'errMode'
							: code === 'method'
								? 'errMethod'
								: code === 'upstream'
									? 'errUpstream'
									: code === 'parse'
										? 'errParse'
										: 'errNetwork';
		/** The four one-click examples the panel offers. */
		const EXAMPLES = [
			{ mode: 'id', query: '2303.08774' },
			{ mode: 'author', query: 'Vaswani' },
			{ mode: 'title', query: 'Attention Is All You Need' },
			{ mode: 'all', query: 'retrieval augmented generation' },
		];
		/** Where the Superman memory listens, from the sibling `superman` bundle. */
		const MEMORY_API = '/api/superman/api';

		/** Encode bytes as canonical base64. */
		function encodeBase64(bytes) {
			let binary = '';
			const step = 0x8000;
			for (let index = 0; index < bytes.length; index += step) {
				binary += String.fromCharCode(...bytes.subarray(index, index + step));
			}
			return btoa(binary);
		}

		/** One memory command; returns the value, or undefined when the memory is absent. */
		async function memoryCommand(body) {
			try {
				const response = await fetch(MEMORY_API, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				});
				const payload = await response.json();
				if (payload === null || typeof payload !== 'object' || payload.ok !== true) return undefined;
				return payload.value;
			} catch {
				return undefined;
			}
		}

		/** The metadata block stored beside a paper, for recall. */
		function paperNote(item, t) {
			return [
				`标题：${item.title}`,
				item.authors.length === 0 ? '' : `作者：${item.authors.join(', ')}`,
				item.primary === '' ? '' : `分类：${item.primary}`,
				item.published === '' ? '' : `发布：${item.published}`,
				item.comment === '' ? '' : `备注：${item.comment}`,
				`arXiv：${item.abs}`,
				'',
				item.summary,
			].filter((line) => line !== '').join('\n');
		}

		/**
		 * Archive one arXiv paper into the Superman memory: the PDF when its bytes
		 * can be fetched, otherwise a record carrying the metadata and abstract.
		 * @param item - the paper.
		 * @param t - translator, for the record kind.
		 * @returns `pdf`, `note`, or `failed`.
		 */
		async function archivePaper(item, t) {
			const text = paperNote(item, t);
			const name = `${(item.id === '' ? item.title : item.id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.pdf`;
			if (typeof item.pdf === 'string' && item.pdf !== '') {
				try {
					const response = await fetch(item.pdf);
					if (response.ok) {
						const bytes = new Uint8Array(await response.arrayBuffer());
						const value = await memoryCommand({
							action: 'store',
							name,
							mime: 'application/pdf',
							base64: encodeBase64(bytes),
							source: 'arxiv',
							text,
						});
						if (value !== undefined) return 'pdf';
					}
				} catch {
					/* a blocked or offline download falls through to the record */
				}
			}
			const value = await memoryCommand({
				action: 'note',
				note: {
					id: `arxiv:${item.id === '' ? item.title : item.id}`,
					kind: 'task',
					title: item.title === '' ? name : item.title,
					text,
					source: 'arxiv',
					tags: [item.primary].filter((tag) => tag !== ''),
				},
			});
			return value === undefined ? 'failed' : 'note';
		}

		/** The arXiv settings section: a query form over a list of papers. */
		function ArxivSection({ t }) {
			const [mode, setMode] = React.useState('all');
			const [query, setQuery] = React.useState('');
			const [size, setSize] = React.useState('20');
			const [sort, setSort] = React.useState('relevance');
			const [state, setState] = React.useState({ status: 'idle' });
			const [expanded, setExpanded] = React.useState(() => new Set());
			const [copied, setCopied] = React.useState();
			/** One archive state per paper id: `saving`, `pdf`, `note`, or `failed`. */
			const [archived, setArchived] = React.useState(() => new Map());
			const runRef = React.useRef();
			React.useEffect(
				() => () => {
					runRef.current?.abort();
				},
				[],
			);
			/**
			 * Run one search against the Host route.
			 * @param nextMode - the field to search, so an example can search immediately.
			 * @param nextQuery - what to search for.
			 */
			const runSearch = async (nextMode, nextQuery) => {
				const value = (nextQuery ?? '').trim();
				if (value === '') {
					setState({ status: 'error', code: 'empty' });
					return;
				}
				runRef.current?.abort();
				const controller = new AbortController();
				runRef.current = controller;
				setState({ status: 'loading' });
				setExpanded(new Set());
				const params = new URLSearchParams({ mode: nextMode, q: value, max: size, sort });
				try {
					const response = await fetch(`${ROUTE}?${params.toString()}`, {
						headers: { accept: 'application/atom+xml' },
						signal: controller.signal,
					});
					const body = await response.text();
					if (controller.signal.aborted) return;
					if (!response.ok) {
						let code = 'network';
						let detail;
						try {
							const parsed = JSON.parse(body);
							code = parsed?.error?.code ?? code;
							detail = parsed?.error?.detail;
						} catch {
							code = 'route';
						}
						setState({ status: 'error', code, detail });
						return;
					}
					const feed = parseFeed(body);
					setState({ status: 'ready', total: feed.total, entries: feed.entries });
				} catch (error) {
					if (controller.signal.aborted) return;
					setState({ status: 'error', code: error?.code ?? 'network', detail: error?.detail ?? String(error?.message ?? error) });
				}
			};
			const search = () => runSearch(mode, query);
			const toggleAbstract = (id) => {
				setExpanded((previous) => {
					const next = new Set(previous);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			};
			const copyCitation = async (item) => {
				const ok = await copyText(bibtexOf(item));
				setCopied(ok ? item.id : undefined);
			};
			/**
			 * Archive one paper into the Superman memory and show how it landed.
			 * @param item - the paper to remember.
			 */
			const remember = async (item) => {
				setArchived((current) => new Map(current).set(item.id, 'saving'));
				const outcome = await archivePaper(item, t);
				setArchived((current) => new Map(current).set(item.id, outcome));
			};
			const entries = state.entries ?? [];
			return React.createElement(
				'div',
				{ className: 'ax_section', 'data-arxiv-section': true },
				React.createElement('h2', { className: 'ax_heading' }, t('title')),
				React.createElement('p', { className: 'ax_intro' }, t('intro')),
				React.createElement(
					'form',
					{
						className: 'ax_form',
						onSubmit: (event) => {
							event.preventDefault();
							return search();
						},
					},
					React.createElement(
						'label',
						{ className: 'ax_field' },
						React.createElement('span', { className: 'ax_label' }, t('modeLabel')),
						React.createElement(
							'select',
							{
								className: 'ax_select',
								value: mode,
								onChange: (event) => setMode(event.target.value),
							},
							MODES.map((option) => React.createElement('option', { key: option, value: option }, t(modeKey(option)))),
						),
					),
					React.createElement(
						'label',
						{ className: 'ax_field ax_grow' },
						React.createElement('span', { className: 'ax_label' }, t('queryLabel')),
						React.createElement('input', {
							className: 'ax_input',
							type: 'search',
							value: query,
							placeholder: t(placeholderKey(mode)),
							onChange: (event) => setQuery(event.target.value),
						}),
					),
					React.createElement(
						'label',
						{ className: 'ax_field' },
						React.createElement('span', { className: 'ax_label' }, t('sizeLabel')),
						React.createElement(
							'select',
							{ className: 'ax_select', value: size, onChange: (event) => setSize(event.target.value) },
							SIZES.map((option) => React.createElement('option', { key: option, value: option }, option)),
						),
					),
					React.createElement(
						'label',
						{ className: 'ax_field' },
						React.createElement('span', { className: 'ax_label' }, t('sortLabel')),
						React.createElement(
							'select',
							{ className: 'ax_select', value: sort, onChange: (event) => setSort(event.target.value) },
							SORTS.map((option) => React.createElement('option', { key: option, value: option }, t(sortKey(option)))),
						),
					),
					React.createElement(
						'button',
						{ type: 'submit', className: 'ax_btn ax_btnPrimary', disabled: state.status === 'loading' },
						t('search'),
					),
				),
				React.createElement(
					'div',
					{ className: 'ax_examples' },
					React.createElement('span', { className: 'ax_examplesLabel' }, t('examples')),
					EXAMPLES.map((example) =>
						React.createElement(
							'button',
							{
								key: `${example.mode}:${example.query}`,
								type: 'button',
								className: 'ax_chip',
								onClick: () => {
									setMode(example.mode);
									setQuery(example.query);
									runSearch(example.mode, example.query);
								},
							},
							example.query,
						),
					),
				),
				React.createElement('p', { className: 'ax_hint' }, t('hint')),
				state.status === 'loading' ? React.createElement('p', { className: 'ax_status' }, t('searching')) : null,
				state.status === 'error'
					? React.createElement(
							'div',
							{ className: 'ax_failure' },
							React.createElement(
								'span',
								null,
								`${t(failureKey(state.code))}${state.detail === undefined ? '' : `: ${state.detail}`}`,
							),
							React.createElement(
								'button',
								{ type: 'button', className: 'ax_btn', onClick: () => search() },
								t('retry'),
							),
						)
					: null,
				state.status === 'ready'
					? React.createElement(
							'div',
							{ className: 'ax_summary' },
							`${t('total')} ${state.total ?? entries.length} ${t('papers')} ${entries.length}${t('shownEnd')}`,
						)
					: null,
				state.status === 'ready' && entries.length === 0
					? React.createElement('p', { className: 'ax_status' }, t('empty'))
					: null,
				entries.length === 0
					? null
					: React.createElement(
							'ul',
							{ className: 'ax_list' },
							entries.map((item) =>
								React.createElement(
									'li',
									{ className: 'ax_card', key: item.id },
									React.createElement(
										'a',
										{ className: 'ax_title', href: item.abs, target: '_blank', rel: 'noopener noreferrer' },
										item.title,
									),
									React.createElement(
										'div',
										{ className: 'ax_meta' },
										React.createElement('span', null, `${t('authors')}: ${item.authors.join(', ')}`),
										item.published === '' ? null : React.createElement('span', null, `${t('published')} ${item.published}`),
										item.primary === '' ? null : React.createElement('span', null, `${t('primary')} ${item.primary}`),
										item.updated === '' || item.updated === item.published
											? null
											: React.createElement('span', null, `${t('updatedLabel')} ${item.updated}`),
									),
									item.comment === '' && item.journalRef === ''
										? null
										: React.createElement(
												'div',
												{ className: 'ax_venue' },
												`${t('venue')}: ${[item.comment, item.journalRef === '' ? undefined : `${t('journal')} ${item.journalRef}`].filter(Boolean).join(' · ')}`,
											),
									React.createElement(
										'p',
										{ className: expanded.has(item.id) ? 'ax_abstract' : 'ax_abstract ax_clamp' },
										item.summary,
									),
									React.createElement(
										'div',
										{ className: 'ax_actions' },
										(() => {
											const state = archived.get(item.id);
											const label = state === 'saving'
												? t('favoriting')
												: state === 'pdf'
													? t('favorited')
													: state === 'note'
														? t('favoritedNote')
														: state === 'failed'
															? t('favoriteFailed')
															: t('favorite');
											return React.createElement(
												'button',
												{
													type: 'button',
													className: state === 'pdf' || state === 'note' ? 'ax_link ax_saved' : state === 'failed' ? 'ax_link ax_failed' : 'ax_link',
													disabled: state === 'saving',
													title: t('favoriteHint'),
													'aria-pressed': state === 'pdf' || state === 'note' ? 'true' : 'false',
													onClick: () => void remember(item),
												},
												React.createElement(
													'svg',
													{ width: 12, height: 12, viewBox: '0 0 24 24', fill: state === 'pdf' || state === 'note' ? 'currentColor' : 'none', 'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: '-1px', marginRight: 4 } },
													React.createElement('path', {
														d: 'M6 3.8h12a1 1 0 0 1 1 1v15.4l-7-4-7 4V4.8a1 1 0 0 1 1-1Z',
														stroke: 'currentColor',
														strokeWidth: 1.6,
														strokeLinejoin: 'round',
													}),
												),
												label,
											);
										})(),
										React.createElement(
											'button',
											{ type: 'button', className: 'ax_link', onClick: () => toggleAbstract(item.id) },
											expanded.has(item.id) ? t('collapse') : t('expand'),
										),
										item.pdf === undefined
											? null
											: React.createElement(
													'a',
													{ className: 'ax_link', href: item.pdf, target: '_blank', rel: 'noopener noreferrer' },
													t('pdf'),
												),
										React.createElement(
											'a',
											{ className: 'ax_link', href: item.abs, target: '_blank', rel: 'noopener noreferrer' },
											t('abs'),
										),
										React.createElement(
											'button',
											{
												type: 'button',
												className: copied === item.id ? 'ax_link ax_copied' : 'ax_link',
												onClick: () => copyCitation(item),
											},
											copied === item.id ? t('copied') : t('copyBibtex'),
										),
									),
								),
							),
						),
			);
		}
		//#endregion

		//#region plugin body
		/**
		 * Register the Settings entry, its dictionaries, and its styles.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(
				() => ctx.locale.register(NS, { zh, en }),
				'arxiv-search: dictionaries',
			);
			ctx.effect(() => {
				const selector = `style[data-plugin-css="${PKG}/arxiv.css"]`;
				document.querySelector(selector)?.remove();
				const tag = document.createElement('style');
				tag.dataset.plugin = PKG;
				tag.dataset.pluginCss = `${PKG}/arxiv.css`;
				tag.textContent = css;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, 'arxiv-search: styles');
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register(
					{
						name: 'settings.section',
						id: SECTION_ID,
						order: 20,
						label: () => t('nav'),
						locale: NS,
					},
					ArxivSection,
				),
			);
		}
		//#endregion

		return { PKG, NS, SECTION_ID, inject, apply };
	},
});

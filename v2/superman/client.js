/**
 * Browser half of the Superman memory bundle.
 *
 * One sidebar entry, `superman`, opens a smart folder over the Host half's
 * frozen memory API (`superman/API.md`): category tabs, file and record cards,
 * a preview pane, one-click delete, and uploads that are base64-encoded in the
 * page and posted to `/api/superman/api`. Nothing but React from the boot
 * module table and theme tokens is used, so the panel follows the app's
 * language and both themes.
 */
window.__ModuleLoader__.load({
	id: '@local/dsh-superman',
	factory: (require) => {
		const React = require('react');
		/** This package's name, used for the style tag's ownership marker. */
		const PKG = '@local/dsh-superman';
		/** Dictionary namespace owned by this plugin. */
		const NS = 'superman';
		/** Sidebar entry id; the same id keys the layout's `main` entry. */
		const PANEL_ID = 'superman';
		/** The Host half's single command route, under the authenticated `/api` channel. */
		const API_URL = '/api/superman/api';
		/** Raw-bytes route for previews and downloads; the item id is appended. */
		const FILE_URL = '/api/superman/file?id=';
		/** Required services (cordis fiber inject). */
		const inject = ['slots', 'locale'];
		/** The four file categories the Host half classifies into. */
		const CATEGORIES = ['pdf', 'image', 'code', 'other'];
		/** Category whose preview is the bytes themselves rather than their text. */
		const IMAGE_CATEGORY = 'image';
		/** The category folders, in the order the tab row shows them. */
		const TABS = [
			{ id: 'all', key: 'tabAll', category: null },
			{ id: 'pdf', key: 'tabPdf', category: 'pdf' },
			{ id: 'image', key: 'tabImage', category: 'image' },
			{ id: 'code', key: 'tabCode', category: 'code' },
			{ id: 'other', key: 'tabOther', category: 'other' },
			{ id: 'notes', key: 'tabNotes', category: null, notes: true },
		];
		/** `React.useMemo` when the host provides it; the offline stub does not. */
		const useMemo = typeof React.useMemo === 'function' ? React.useMemo : (factory) => factory();

		//#region helpers
		/**
		 * Create a snapshot store shaped for the renderer's selector Hooks:
		 * `getSnapshot` returns the same reference until `update` publishes a new one.
		 * @param initial - the first snapshot.
		 * @returns the store.
		 */
		function createStore(initial) {
			let snapshot = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				update(mutate) {
					const draft = { ...snapshot };
					mutate(draft);
					snapshot = draft;
					for (const listener of [...listeners]) listener();
				},
			};
		}

		/**
		 * Human-readable byte size for a card or preview.
		 * @param bytes - stored byte length.
		 * @param t - translator for the unknown-size label.
		 * @returns a short label such as `1.2 MB`.
		 */
		function formatBytes(bytes, t) {
			const value = Number(bytes);
			if (!Number.isFinite(value) || value <= 0) return t('sizeUnknown');
			if (value < 1024) return `${value} B`;
			if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
			if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
			return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
		}

		/**
		 * Relative time for a card, in the app's language.
		 * @param timestamp - epoch milliseconds.
		 * @param t - translator.
		 * @returns a short label such as `3 分钟前`.
		 */
		function relativeTime(timestamp, t) {
			const value = Number(timestamp);
			if (!Number.isFinite(value) || value <= 0) return t('timeUnknown');
			const delta = Date.now() - value;
			if (delta < 60_000) return t('timeNow');
			if (delta < 3_600_000) return t('timeMinutes').replace('{n}', String(Math.max(1, Math.round(delta / 60_000))));
			if (delta < 86_400_000) return t('timeHours').replace('{n}', String(Math.max(1, Math.round(delta / 3_600_000))));
			const date = new Date(value);
			const today = new Date();
			if (date.toDateString() === today.toDateString()) {
				return t('timeToday').replace('{time}', `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
			}
			if (date.toDateString() === new Date(today.getTime() - 86_400_000).toDateString()) return t('timeYesterday');
			if (delta < 7 * 86_400_000) return t('timeDays').replace('{n}', String(Math.max(1, Math.round(delta / 86_400_000))));
			return `${date.getMonth() + 1}/${date.getDate()}`;
		}

		/**
		 * Dictionary key of one category badge or tab.
		 * @param category - `pdf` | `image` | `code` | `other` | `dialog`.
		 * @returns the key, defaulting to `catOther`.
		 */
		function categoryKey(category) {
			if (category === 'pdf') return 'catPdf';
			if (category === 'image') return 'catImage';
			if (category === 'code') return 'catCode';
			if (category === 'dialog') return 'catDialog';
			return 'catOther';
		}

		/**
		 * Localized label of one item's source.
		 * @param source - `chat` | `harness` | `superman` | anything else.
		 * @param t - translator.
		 * @returns the badge text.
		 */
		function sourceLabel(source, t) {
			if (source === 'chat') return t('sourceChat');
			if (source === 'harness') return t('sourceHarness');
			if (source === 'superman') return t('sourceSuperman');
			return t('sourceUnknown');
		}

		/**
		 * Title of one conversation or task record.
		 * @param note - a Note from the list payload.
		 * @param t - translator for the fallback.
		 * @returns the title text.
		 */
		function noteTitle(note, t) {
			return typeof note?.title === 'string' && note.title !== '' ? note.title : t('nameFallback');
		}

		/**
		 * One-line kind label of a record.
		 * @param note - a Note from the list payload.
		 * @param t - translator.
		 * @returns `task` or `conversation` in the app's language.
		 */
		function noteKind(note, t) {
			return note?.kind === 'conversation' ? t('noteConversation') : t('noteTask');
		}

		/**
		 * Base64-encode bytes without blowing the argument limit: `String.fromCharCode`
		 * is applied in chunks before `btoa`.
		 * @param bytes - the file's bytes.
		 * @returns canonical base64.
		 */
		function encodeBase64(bytes) {
			let binary = '';
			const step = 0x8000;
			for (let index = 0; index < bytes.length; index += step) {
				binary += String.fromCharCode(...bytes.subarray(index, index + step));
			}
			return btoa(binary);
		}

		/**
		 * Message text of a thrown value.
		 * @param error - whatever was caught.
		 * @param t - translator for the fallback.
		 * @returns a non-empty message.
		 */
		function messageOf(error, t) {
			const message = error instanceof Error && typeof error.message === 'string' ? error.message : '';
			return message === '' ? t('errorUnknown') : message;
		}

		/**
		 * Counts shown on each tab. `stats` is authoritative when the Host half
		 * sent a complete one; otherwise the loaded list is counted instead.
		 * @param items - loaded items.
		 * @param notes - loaded records.
		 * @param stats - the payload's `stats`, or null.
		 * @returns one count per tab id.
		 */
		function tabCounts(items, notes, stats) {
			const categories = stats !== null && typeof stats.categories === 'object' && stats.categories !== null ? stats.categories : {};
			const counted = {};
			for (const category of CATEGORIES) counted[category] = 0;
			for (const item of items) {
				const category = typeof item?.category === 'string' && CATEGORIES.includes(item.category) ? item.category : 'other';
				counted[category] += 1;
			}
			const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
			return {
				all: number(stats?.total, items.length) + number(stats?.notes, notes.length),
				pdf: number(categories.pdf, counted.pdf),
				image: number(categories.image, counted.image),
				code: number(categories.code, counted.code),
				other: number(categories.other, counted.other),
				notes: number(stats?.notes, notes.length),
			};
		}

		/**
		 * Whether one item matches the search box: name, snippet, and category label.
		 * @param item - one loaded item.
		 * @param needle - the lower-cased query, or an empty string.
		 * @param t - translator for the category label.
		 * @returns whether the item stays visible.
		 */
		function matchesItem(item, needle, t) {
			if (needle === '') return true;
			const name = typeof item?.name === 'string' ? item.name : '';
			const snippet = typeof item?.snippet === 'string' ? item.snippet : '';
			const text = typeof item?.text === 'string' ? item.text : '';
			const label = t(categoryKey(typeof item?.category === 'string' ? item.category : 'other'));
			return `${name}\n${snippet}\n${text}\n${label}`.toLowerCase().includes(needle);
		}

		/**
		 * Whether one record matches the search box: title, text, and kind label.
		 * @param note - one loaded record.
		 * @param needle - the lower-cased query, or an empty string.
		 * @param t - translator.
		 * @returns whether the record stays visible.
		 */
		function matchesNote(note, needle, t) {
			if (needle === '') return true;
			const title = typeof note?.title === 'string' ? note.title : '';
			const text = typeof note?.text === 'string' ? note.text : '';
			const label = `${noteKind(note, t)}\n${t('catDialog')}`;
			return `${title}\n${text}\n${label}`.toLowerCase().includes(needle);
		}

		/**
		 * The items and records one tab and query leave visible. `全部` is the whole
		 * memory — both files and records — while a file tab is only its category.
		 * @param items - loaded items.
		 * @param notes - loaded records.
		 * @param category - the active tab id.
		 * @param needle - the lower-cased query, or an empty string.
		 * @param t - translator.
		 * @returns the visible lists.
		 */
		function selectVisible(items, notes, category, needle, t) {
			if (category === 'notes') {
				return {
					items: [],
					notes: notes.filter((note) => matchesNote(note, needle, t)),
				};
			}
			return {
				items: items.filter((item) => {
					if (category !== 'all' && item?.category !== category) return false;
					return matchesItem(item, needle, t);
				}),
				notes: category === 'all' ? notes.filter((note) => matchesNote(note, needle, t)) : [],
			};
		}
		//#endregion

		//#region locales
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			panel: 'Superman',
			toastTitle: '记忆体已记住',
			toastOpen: '打开记忆体',
			title: '记忆体 Superman',
			refresh: '刷新',
			upload: '上传',
			uploading: '上传中…',
			search: '搜索名称、片段或分类',
			tabAll: '全部',
			tabPdf: 'PDF',
			tabImage: '图片',
			tabCode: '程序',
			tabOther: '其他',
			tabNotes: '对话记录',
			catPdf: 'PDF',
			catImage: '图片',
			catCode: '程序',
			catOther: '其他',
			catDialog: '记录',
			sourceChat: 'Chat',
			sourceHarness: 'Harness',
			sourceSuperman: '记忆体',
			sourceUnknown: '未知来源',
			noteTask: '任务',
			noteConversation: '对话',
			rootFallback: '记忆体目录未知',
			nameFallback: '未命名',
			loading: '正在读取记忆体…',
			emptyAll: '记忆体还是空的：上传文件，或让对话与任务在这里留下记录。',
			emptyNotes: '还没有对话或任务记录。',
			emptyFiltered: '没有匹配的条目。',
			errorLoad: '记忆体读取失败',
			errorGet: '读取内容失败',
			errorUnknown: '未知错误',
			retry: '重试',
			delete: '删除',
			preview: '预览',
			previewEmpty: '选择一项，在这里查看内容。',
			openFile: '在新标签页打开',
			noText: '没有可显示的文本内容。',
			uploadFailed: '上传失败：{name}',
			dropTitle: '存入记忆体',
			dropHint: '松开即可上传文件',
			sizeUnknown: '大小未知',
			timeUnknown: '时间未知',
			timeNow: '刚刚',
			timeMinutes: '{n} 分钟前',
			timeHours: '{n} 小时前',
			timeToday: '今天 {time}',
			timeYesterday: '昨天',
			timeDays: '{n} 天前',
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			panel: 'Superman',
			toastTitle: 'Superman remembered',
			toastOpen: 'Open the memory',
			title: 'Superman memory',
			refresh: 'Refresh',
			upload: 'Upload',
			uploading: 'Uploading…',
			search: 'Search name, snippet, or category',
			tabAll: 'All',
			tabPdf: 'PDF',
			tabImage: 'Images',
			tabCode: 'Code',
			tabOther: 'Other',
			tabNotes: 'Records',
			catPdf: 'PDF',
			catImage: 'Image',
			catCode: 'Code',
			catOther: 'Other',
			catDialog: 'Record',
			sourceChat: 'Chat',
			sourceHarness: 'Harness',
			sourceSuperman: 'Memory',
			sourceUnknown: 'Unknown source',
			noteTask: 'Task',
			noteConversation: 'Conversation',
			rootFallback: 'Memory folder unknown',
			nameFallback: 'Untitled',
			loading: 'Reading the memory…',
			emptyAll: 'The memory is empty: upload a file, or let a conversation or task leave a record here.',
			emptyNotes: 'No conversation or task records yet.',
			emptyFiltered: 'Nothing matches the current filter.',
			errorLoad: 'Could not read the memory',
			errorGet: 'Could not read the content',
			errorUnknown: 'Unknown error',
			retry: 'Retry',
			delete: 'Delete',
			preview: 'Preview',
			previewEmpty: 'Select an entry to preview it here.',
			openFile: 'Open in a new tab',
			noText: 'No text content to show.',
			uploadFailed: 'Upload failed: {name}',
			dropTitle: 'Save into the memory',
			dropHint: 'Drop to upload the files',
			sizeUnknown: 'Unknown size',
			timeUnknown: 'Unknown time',
			timeNow: 'just now',
			timeMinutes: '{n} min ago',
			timeHours: '{n} h ago',
			timeToday: 'today {time}',
			timeYesterday: 'yesterday',
			timeDays: '{n} d ago',
		};
		//#endregion

		//#region controller
		/**
		 * The panel's data layer: one snapshot store plus the four commands the
		 * cards and header call. The page never touches `fetch` outside `request`.
		 * @param t - translator bound to this plugin's namespace.
		 * @returns the store, the actions, and a disposer.
		 */
		function createMemory(t, onRemembered) {
			const store = createStore({
				status: 'loading',
				items: [],
				notes: [],
				stats: null,
				root: '',
				error: null,
				uploads: [],
				uploading: false,
				selected: null,
				preview: null,
			});
			let disposed = false;

			/**
			 * POST one JSON command and unwrap the frozen envelope.
			 * @param body - the command, such as `{ action: 'list' }`.
			 * @returns the `value` object of a successful reply.
			 */
			async function request(body) {
				const response = await fetch(API_URL, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				});
				let payload;
				try {
					payload = await response.json();
				} catch {
					throw new Error(t('errorUnknown'));
				}
				if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
					const detail = payload !== null && typeof payload === 'object' ? payload.error : null;
					const message = typeof detail?.message === 'string' && detail.message !== ''
						? detail.message
						: typeof detail?.code === 'string' && detail.code !== '' ? detail.code : '';
					throw new Error(message === '' ? t('errorUnknown') : message);
				}
				return payload.value !== null && typeof payload.value === 'object' ? payload.value : {};
			}

			/** Read the whole folder: items, records, stats, and the root path. */
			async function load() {
				store.update((draft) => {
					draft.status = 'loading';
					draft.error = null;
				});
				try {
					const value = await request({ action: 'list' });
					if (disposed) return;
					const items = Array.isArray(value.items) ? value.items.filter((entry) => entry !== null && typeof entry === 'object') : [];
					const notes = Array.isArray(value.notes) ? value.notes.filter((entry) => entry !== null && typeof entry === 'object') : [];
					store.update((draft) => {
						draft.status = 'ready';
						draft.items = items;
						draft.notes = notes;
						draft.stats = value.stats !== null && typeof value.stats === 'object' ? value.stats : null;
						draft.root = typeof value.root === 'string' ? value.root : '';
						draft.error = null;
					});
				} catch (error) {
					if (disposed) return;
					store.update((draft) => {
						draft.status = 'error';
						draft.error = messageOf(error, t);
					});
				}
			}

			/**
			 * Select one item or record and fill the preview pane. Images preview
			 * their bytes directly; everything else asks the Host half for text.
			 * @param entry - one item or Note from the list payload.
			 */
			async function open(entry) {
				if (entry === null || typeof entry !== 'object') return;
				const id = typeof entry.id === 'string' ? entry.id : '';
				if (typeof entry.category !== 'string') {
					store.update((draft) => {
						draft.selected = id;
						draft.preview = {
							kind: 'dialog',
							id,
							name: noteTitle(entry, t),
							item: { detail: noteKind(entry, t) },
							text: typeof entry.text === 'string' ? entry.text : '',
							status: 'ready',
						};
					});
					return;
				}
				const category = CATEGORIES.includes(entry.category) ? entry.category : 'other';
				store.update((draft) => {
					draft.selected = id;
					draft.preview = {
						kind: category,
						id,
						name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : t('nameFallback'),
						item: entry,
						text: '',
						status: category === IMAGE_CATEGORY ? 'ready' : 'loading',
					};
				});
				if (category === IMAGE_CATEGORY) return;
				try {
					const value = await request({ action: 'get', id });
					if (disposed) return;
					const item = value.item !== null && typeof value.item === 'object' ? value.item : entry;
					store.update((draft) => {
						draft.preview = {
							kind: category,
							id,
							name: typeof item.name === 'string' && item.name !== '' ? item.name : t('nameFallback'),
							item,
							text: typeof item.text === 'string' ? item.text : '',
							status: 'ready',
						};
					});
				} catch (error) {
					if (disposed) return;
					store.update((draft) => {
						draft.preview = {
							kind: category,
							id,
							name: typeof entry.name === 'string' ? entry.name : t('nameFallback'),
							item: entry,
							text: '',
							status: 'error',
							error: messageOf(error, t),
						};
					});
				}
			}

			/**
			 * Delete one item or record in a single click, then refresh the list.
			 * @param id - the entry id.
			 */
			async function remove(id) {
				const target = typeof id === 'string' ? id : '';
				if (target === '') return;
				try {
					await request({ action: 'delete', id: target });
				} catch (error) {
					if (disposed) return;
					store.update((draft) => {
						draft.error = messageOf(error, t);
					});
					return;
				}
				if (disposed) return;
				store.update((draft) => {
					if (draft.selected === target) {
						draft.selected = null;
						draft.preview = null;
					}
				});
				await load();
			}

			/**
			 * Store every picked file, one at a time. A file that fails collects its
			 * own error line and the rest still go through.
			 * @param fileList - the input's files or a drop's `dataTransfer.files`.
			 */
			async function upload(fileList) {
				const files = [...(fileList ?? [])].filter((file) => file !== null && typeof file === 'object');
				if (files.length === 0) return;
				store.update((draft) => {
					draft.uploading = true;
					draft.uploads = [];
				});
				const failures = [];
				for (const file of files) {
					const name = typeof file.name === 'string' && file.name !== '' ? file.name : 'file';
					try {
						if (typeof file.arrayBuffer !== 'function') throw new Error(t('errorUnknown'));
						const buffer = await file.arrayBuffer();
						const base64 = encodeBase64(new Uint8Array(buffer));
						const value = await request({
							action: 'store',
							name,
							mime: typeof file.type === 'string' ? file.type : '',
							base64,
							source: 'superman',
						});
						onRemembered?.(value?.item);
					} catch (error) {
						failures.push({ name, message: messageOf(error, t) });
					}
				}
				if (disposed) return;
				store.update((draft) => {
					draft.uploading = false;
					draft.uploads = failures;
				});
				await load();
			}

			return {
				store,
				actions: { load, open, remove, upload },
				dispose() {
					disposed = true;
				},
			};
		}
		//#endregion

		//#region panel
		/**
		 * One file card: name, category badge, detail, relative time, source badge,
		 * and the snippet when the list carried one.
		 * @param props - the item, the translator, and the two handlers.
		 * @returns the card element.
		 */
		function ItemCard({ item, t, onOpen, onRemove, active }) {
			const name = typeof item?.name === 'string' && item.name !== '' ? item.name : t('nameFallback');
			const category = typeof item?.category === 'string' ? item.category : 'other';
			const detail = typeof item?.detail === 'string' && item.detail !== '' ? item.detail : formatBytes(item?.bytes, t);
			const snippet = typeof item?.snippet === 'string' && item.snippet !== ''
				? item.snippet
				: typeof item?.text === 'string' ? item.text : '';
			return React.createElement(
				'div',
				{ className: active ? 'sm_card sm_cardActive' : 'sm_card' },
				React.createElement(
					'button',
					{ type: 'button', className: 'sm_cardOpen', onClick: () => onOpen(item) },
					React.createElement(
						'span',
						{ className: 'sm_cardTop' },
						React.createElement('span', { className: 'sm_cardName', title: name }, name),
						React.createElement('span', { className: 'sm_badge sm_badgeCat' }, t(categoryKey(category))),
					),
					React.createElement(
						'span',
						{ className: 'sm_cardMeta' },
						React.createElement('span', { className: 'sm_cardDetail' }, detail),
						React.createElement('span', { className: 'sm_cardTime' }, relativeTime(item?.addedAt, t)),
						React.createElement('span', { className: 'sm_badge sm_badgeSource' }, sourceLabel(item?.source, t)),
					),
					snippet === '' ? null : React.createElement('span', { className: 'sm_cardSnippet' }, snippet),
				),
				React.createElement(
					'button',
					{
						type: 'button',
						className: 'sm_cardDelete',
						title: `${t('delete')}: ${name}`,
						'aria-label': `${t('delete')}: ${name}`,
						onClick: (event) => {
							event.stopPropagation();
							onRemove(item?.id);
						},
					},
					'×',
				),
			);
		}

		/**
		 * One conversation/task record card, shaped like a file card so the list
		 * reads as one column.
		 * @param props - the record, the translator, and the two handlers.
		 * @returns the card element.
		 */
		function NoteCard({ note, t, onOpen, onRemove, active }) {
			const title = noteTitle(note, t);
			const text = typeof note?.text === 'string' ? note.text : '';
			return React.createElement(
				'div',
				{ className: active ? 'sm_card sm_cardActive' : 'sm_card' },
				React.createElement(
					'button',
					{ type: 'button', className: 'sm_cardOpen', onClick: () => onOpen(note) },
					React.createElement(
						'span',
						{ className: 'sm_cardTop' },
						React.createElement('span', { className: 'sm_cardName', title }, title),
						React.createElement('span', { className: 'sm_badge sm_badgeCat' }, t('catDialog')),
					),
					React.createElement(
						'span',
						{ className: 'sm_cardMeta' },
						React.createElement('span', { className: 'sm_cardDetail' }, noteKind(note, t)),
						React.createElement('span', { className: 'sm_cardTime' }, relativeTime(note?.updatedAt, t)),
						React.createElement('span', { className: 'sm_badge sm_badgeSource' }, sourceLabel(note?.source, t)),
					),
					text === '' ? null : React.createElement('span', { className: 'sm_cardSnippet' }, text),
				),
				React.createElement(
					'button',
					{
						type: 'button',
						className: 'sm_cardDelete',
						title: `${t('delete')}: ${title}`,
						'aria-label': `${t('delete')}: ${title}`,
						onClick: (event) => {
							event.stopPropagation();
							onRemove(note?.id);
						},
					},
					'×',
				),
			);
		}

		/**
		 * The preview pane: images render their bytes, text-bearing entries render
		 * the Host half's extracted text, and every entry keeps a raw link.
		 * @param props - the preview descriptor and the translator.
		 * @returns the aside element.
		 */
		function Preview({ preview, t }) {
			if (preview === null || preview === undefined || typeof preview !== 'object') {
				return React.createElement('aside', { className: 'sm_preview sm_previewEmpty', 'aria-label': t('preview') }, t('previewEmpty'));
			}
			const name = typeof preview.name === 'string' && preview.name !== '' ? preview.name : t('nameFallback');
			const item = preview.item !== null && typeof preview.item === 'object' ? preview.item : {};
			const detail = typeof item.detail === 'string' && item.detail !== '' ? item.detail : formatBytes(item.bytes, t);
			const link = preview.id === '' ? null : React.createElement(
				'a',
				{ className: 'sm_link', href: FILE_URL + preview.id, target: '_blank', rel: 'noopener noreferrer' },
				t('openFile'),
			);
			let body;
			if (preview.kind === IMAGE_CATEGORY) {
				body = React.createElement('img', { className: 'sm_previewImage', src: FILE_URL + preview.id, alt: name });
			} else if (preview.status === 'error') {
				body = React.createElement('div', { className: 'sm_errorText' }, `${t('errorGet')} · ${typeof preview.error === 'string' ? preview.error : ''}`);
			} else if (preview.status === 'loading') {
				body = React.createElement('div', { className: 'sm_loading' }, t('loading'));
			} else if (typeof preview.text === 'string' && preview.text !== '') {
				body = React.createElement('pre', { className: 'sm_previewText' }, preview.text);
			} else {
				body = React.createElement('div', { className: 'sm_previewMeta' }, t('noText'));
			}
			return React.createElement(
				'aside',
				{ className: 'sm_preview', 'aria-label': t('preview') },
				React.createElement(
					'div',
					{ className: 'sm_previewHead' },
					React.createElement('div', { className: 'sm_previewTitle', title: name }, name),
					link,
				),
				React.createElement(
					'div',
					{ className: 'sm_previewMeta' },
					React.createElement('span', { className: 'sm_badge' }, t(categoryKey(preview.kind))),
					React.createElement('span', { className: 'sm_cardDetail' }, detail),
					React.createElement('span', { className: 'sm_cardTime' }, relativeTime(item.addedAt ?? item.updatedAt, t)),
				),
				body,
			);
		}

		//#region notices
		/**
		 * "Superman remembered a file" notices.
		 *
		 * The memory is filled from four places — this panel, Chat mode, Harness
		 * mode, and other plugins — so a notice cannot be tied to one action: a
		 * watcher polls the memory, and every item this page has not seen before
		 * becomes one toast. The panel's own uploads report straight away.
		 */

		/** How often the watcher asks the memory what is new, in milliseconds. */
		const WATCH_INTERVAL_MS = 4000;
		/** How long one toast stays on screen, in milliseconds. */
		const TOAST_MS = 7000;

		/**
		 * Ask the memory one command without the panel's error handling.
		 * @param body - a command body, per `superman/API.md`.
		 * @returns the command's value, or undefined when the memory is unavailable.
		 */
		async function memoryRequest(body) {
			try {
				const response = await fetch(API_URL, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				});
				const payload = await response.json();
				return payload !== null && typeof payload === 'object' && payload.ok === true ? payload.value : undefined;
			} catch {
				return undefined;
			}
		}

		/**
		 * Queue of remembered items, deduplicated by item id.
		 * @returns the toast store plus the operations over it.
		 */
		function createNotifier() {
			const store = createStore({ toasts: [] });
			const shown = new Set();
			let counter = 0;

			/**
			 * Show one "remembered" notice.
			 * @param item - the memory item that was just stored.
			 */
			function notify(item) {
				if (item === null || typeof item !== 'object' || typeof item.id !== 'string') return;
				if (shown.has(item.id)) return;
				shown.add(item.id);
				const id = `toast-${counter++}`;
				store.update((draft) => {
					draft.toasts = [...draft.toasts, { id, item, at: Date.now() }];
				});
				window.setTimeout(() => dismiss(id), TOAST_MS);
			}

			/**
			 * Drop one toast.
			 * @param id - the toast id.
			 */
			function dismiss(id) {
				store.update((draft) => {
					draft.toasts = draft.toasts.filter((toast) => toast.id !== id);
				});
			}

			return { store, notify, dismiss };
		}

		/**
		 * Watch the memory for items this page has not seen yet.
		 * @param notify - called once per new item.
		 * @param onNew - called when anything new arrived, so an open panel refreshes.
		 * @returns the disposer.
		 */
		function createWatcher(notify, onNew) {
			let known = null;
			/** The poll in flight, so callers share one round trip instead of racing. */
			let inFlight = null;
			/**
			 * Ask the memory for its list and diff it against what this page has seen.
			 * @returns completion of this round, or of the round already running.
			 */
			function poll() {
				if (inFlight !== null) return inFlight;
				inFlight = (async () => {
					const value = await memoryRequest({ action: 'list' });
					const items = Array.isArray(value?.items) ? value.items : null;
					if (items === null) return;
					const notes = Array.isArray(value?.notes) ? value.notes : [];
					if (known === null) {
						/* The first answer is the baseline: nothing already there is announced. */
						known = new Set([...items, ...notes].map((entry) => entry.id));
						return;
					}
					let fresh = false;
					for (const item of items) {
						if (known.has(item.id)) continue;
						known.add(item.id);
						fresh = true;
						notify(item);
					}
					for (const note of notes) {
						if (known.has(note.id)) continue;
						known.add(note.id);
						fresh = true;
						notify({ ...note, category: 'dialog', name: note.title, detail: '' });
					}
					if (fresh) onNew();
				})().finally(() => {
					inFlight = null;
				});
				return inFlight;
			}
			const timer = window.setInterval(() => void poll(), WATCH_INTERVAL_MS);
			void poll();
			return {
				poll,
				dispose() {
					window.clearInterval(timer);
				},
			};
		}

		/** The floating notices, one card per remembered file. */
		function ToastStack(props) {
			const { t, useToasts, dismiss, openPanel } = props;
			const state = useToasts((snapshot) => snapshot);
			const toasts = Array.isArray(state?.toasts) ? state.toasts : [];
			if (toasts.length === 0) return null;
			return React.createElement(
				'div',
				{ className: 'sm_toasts', role: 'status', 'aria-live': 'polite' },
				toasts.map((toast) => {
					const name = typeof toast.item?.name === 'string' && toast.item.name !== '' ? toast.item.name : t('nameFallback');
					const detail = typeof toast.item?.detail === 'string' && toast.item.detail !== '' ? ` · ${toast.item.detail}` : '';
					return React.createElement(
						'button',
						{
							key: toast.id,
							type: 'button',
							className: 'sm_toast',
							title: t('toastOpen'),
							onClick: () => {
								dismiss(toast.id);
								openPanel();
							},
						},
						React.createElement(
							'span',
							{ className: 'sm_toastMark', 'aria-hidden': 'true' },
							React.createElement(
								'svg',
								{ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
								React.createElement('path', {
									d: 'M9.4 12.6 11.4 14.6 15.6 10',
									stroke: 'currentColor',
									strokeWidth: 1.8,
									strokeLinecap: 'round',
									strokeLinejoin: 'round',
								}),
							),
						),
						React.createElement(
							'span',
							{ className: 'sm_toastBody' },
							React.createElement('span', { className: 'sm_toastTitle' }, t('toastTitle')),
							React.createElement('span', { className: 'sm_toastName' }, name),
							React.createElement('span', { className: 'sm_toastMeta' }, `${t(categoryKey(toast.item?.category))}${detail}`),
						),
						React.createElement('span', { className: 'sm_toastClose', 'aria-hidden': 'true' }, '×'),
					);
				}),
			);
		}
		//#endregion

		/**
		 * The Superman memory panel: header, search, category tabs, cards, preview,
		 * and drag-and-drop upload.
		 * @param props - the translator, the store Hook, and the controller actions.
		 * @returns the panel element.
		 */
		function Panel(props) {
			const { t, useStore, load, open, remove, upload } = props;
			const state = useStore((snapshot) => snapshot);
			const [query, setQuery] = React.useState('');
			const [category, setCategory] = React.useState('all');
			const [dragging, setDragging] = React.useState(false);
			const fileRef = React.useRef(null);
			React.useEffect(() => {
				load();
			}, [load]);

			const items = Array.isArray(state.items) ? state.items : [];
			const notes = Array.isArray(state.notes) ? state.notes : [];
			const stats = state.stats !== null && typeof state.stats === 'object' ? state.stats : null;
			const uploads = Array.isArray(state.uploads) ? state.uploads : [];
			const counts = useMemo(() => tabCounts(items, notes, stats), [items, notes, stats]);
			const needle = query.trim().toLowerCase();
			const visible = useMemo(() => selectVisible(items, notes, category, needle, t), [items, notes, category, needle, t]);
			const total = visible.items.length + visible.notes.length;
			const emptyLabel = needle !== ''
				? t('emptyFiltered')
				: category === 'notes' ? t('emptyNotes') : t('emptyAll');
			const loading = state.status === 'loading' && items.length === 0 && notes.length === 0;

			const tabs = TABS.map((tab) => React.createElement(
				'button',
				{
					key: tab.id,
					type: 'button',
					className: category === tab.id ? 'sm_tab sm_tabActive' : 'sm_tab',
					'aria-pressed': category === tab.id ? 'true' : 'false',
					onClick: () => setCategory(tab.id),
				},
				React.createElement('span', { className: 'sm_tabLabel' }, t(tab.key)),
				React.createElement('span', { className: 'sm_tabCount' }, String(counts[tab.id] ?? 0)),
			));

			const cards = [
				...visible.items.map((item) => React.createElement(ItemCard, {
					key: `item:${item.id ?? item.name}`,
					item,
					t,
					active: state.selected !== null && state.selected === item.id,
					onOpen: open,
					onRemove: remove,
				})),
				...visible.notes.map((note) => React.createElement(NoteCard, {
					key: `note:${note.id ?? note.title}`,
					note,
					t,
					active: state.selected !== null && state.selected === note.id,
					onOpen: open,
					onRemove: remove,
				})),
			];

			const rootPath = typeof state.root === 'string' && state.root !== '' ? state.root : t('rootFallback');

			return React.createElement(
				'section',
				{
					className: dragging ? 'sm_root sm_dragging' : 'sm_root',
					'data-superman': true,
					onDragOver: (event) => {
						event.preventDefault();
						setDragging(true);
					},
					onDragLeave: (event) => {
						if (event.currentTarget.contains(event.relatedTarget)) return;
						setDragging(false);
					},
					onDrop: (event) => {
						event.preventDefault();
						setDragging(false);
						if (event.dataTransfer?.files?.length > 0) upload(event.dataTransfer.files);
					},
				},
				React.createElement(
					'header',
					{ className: 'sm_head', 'data-window-drag': true },
					React.createElement(
						'div',
						{ className: 'sm_headText' },
						React.createElement('h1', { className: 'sm_title' }, t('title')),
						React.createElement('span', { className: 'sm_rootPath', title: rootPath }, rootPath),
					),
					React.createElement(
						'div',
						{ className: 'sm_headActions' },
						React.createElement(
							'button',
							{
								type: 'button',
								className: 'sm_iconBtn',
								title: t('refresh'),
								'aria-label': t('refresh'),
								onClick: () => load(),
							},
							React.createElement(
								'svg',
								{ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', style: { display: 'block' } },
								React.createElement('path', {
									d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.6v4h-4',
									stroke: 'currentColor',
									strokeWidth: 1.6,
									strokeLinecap: 'round',
									strokeLinejoin: 'round',
								}),
							),
						),
						React.createElement(
							'button',
							{
								type: 'button',
								className: 'sm_ghost',
								disabled: state.uploading === true,
								onClick: () => fileRef.current?.click(),
							},
							state.uploading === true ? t('uploading') : t('upload'),
						),
						React.createElement('input', {
							type: 'file',
							multiple: true,
							ref: fileRef,
							className: 'sm_fileInput',
							tabIndex: -1,
							'aria-hidden': 'true',
							onChange: (event) => {
								upload(event.target.files);
								event.target.value = '';
							},
						}),
					),
				),
				React.createElement(
					'div',
					{ className: 'sm_searchRow' },
					React.createElement('input', {
						className: 'sm_search',
						type: 'search',
						value: query,
						placeholder: t('search'),
						'aria-label': t('search'),
						onChange: (event) => setQuery(event.target.value),
					}),
				),
				React.createElement('div', { className: 'sm_tabs', role: 'tablist' }, tabs),
				state.error === null
					? null
					: React.createElement(
							'div',
							{ className: 'sm_notice sm_noticeError' },
							React.createElement('span', { className: 'sm_errorText' }, `${t('errorLoad')} · ${state.error}`),
							React.createElement('button', { type: 'button', className: 'sm_link', onClick: () => load() }, t('retry')),
						),
				uploads.length === 0
					? null
					: React.createElement(
							'div',
							{ className: 'sm_notice sm_noticeError' },
							uploads.map((failure) => React.createElement(
								'div',
								{ key: `upload:${failure?.name ?? ''}`, className: 'sm_errorText' },
								`${t('uploadFailed').replace('{name}', String(failure?.name ?? ''))} ${failure?.message === undefined ? '' : `· ${failure.message}`}`,
							)),
						),
				React.createElement(
					'div',
					{ className: 'sm_body' },
					React.createElement(
						'div',
						{ className: 'sm_list' },
						loading
							? React.createElement('div', { className: 'sm_loading' }, t('loading'))
							: total === 0 ? React.createElement('div', { className: 'sm_empty' }, emptyLabel) : cards,
					),
					React.createElement(Preview, { preview: state.preview, t }),
				),
				dragging
					? React.createElement(
							'div',
							{ className: 'sm_drop' },
							React.createElement(
								'div',
								{ className: 'sm_dropCard' },
								React.createElement('strong', null, t('dropTitle')),
								React.createElement('span', null, t('dropHint')),
							),
						)
					: null,
			);
		}

		/**
		 * Sidebar icon: a folder with an up-arrow, sized by the sidebar.
		 * @param props - the sidebar's `size`.
		 * @returns the svg element.
		 */
		function PanelIcon({ size }) {
			const edge = Number.isFinite(size) && size > 0 ? size : 20;
			return React.createElement(
				'svg',
				{
					width: edge,
					height: edge,
					viewBox: '0 0 24 24',
					fill: 'none',
					'aria-hidden': 'true',
					style: { display: 'block' },
				},
				React.createElement('path', {
					d: 'M12 5.2a3.1 3.1 0 0 0-5.6 1.6c-1.4.4-2.4 1.7-2.4 3.2 0 .9.4 1.8 1 2.4-.2.5-.3 1-.3 1.5a3.3 3.3 0 0 0 4.9 2.9c.4.7 1.2 1.2 2.4 1.2V5.2Z',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinejoin: 'round',
				}),
				React.createElement('path', {
					d: 'M12 5.2a3.1 3.1 0 0 1 5.6 1.6c1.4.4 2.4 1.7 2.4 3.2 0 .9-.4 1.8-1 2.4.2.5.3 1 .3 1.5a3.3 3.3 0 0 1-4.9 2.9c-.4.7-1.2 1.2-2.4 1.2',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinejoin: 'round',
				}),
				React.createElement('path', {
					d: 'M12 5.2v13.6M9.2 8.6h.9M9 12.2h1.1M15 8.6h-.9M15.2 12.2H14',
					stroke: 'currentColor',
					strokeWidth: 1.3,
					strokeLinecap: 'round',
				}),
			);
		}
		//#endregion

		//#region styles
		const css = [
			'.sm_root{box-sizing:border-box;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);flex-direction:column;display:flex;position:relative}',
			'.sm_root *{box-sizing:border-box}',
			'.sm_head{flex:none;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 20px 8px;display:flex}',
			'[data-platform=darwin] .sm_head{padding-top:calc(14px + var(--dsh-frame-top-clearance,0px))}',
			'.sm_headText{flex-direction:column;gap:2px;min-width:0;display:flex}',
			'.sm_title{margin:0;font-size:14px;font-weight:500;line-height:20px}',
			'.sm_rootPath{color:var(--dsw-alias-label-caption);text-overflow:ellipsis;white-space:nowrap;max-width:46vw;font-size:11px;line-height:16px;overflow:hidden}',
			'.sm_headActions{-webkit-app-region:no-drag;align-items:center;gap:8px;flex:none;display:flex}',
			'.sm_ghost{height:28px;padding:0 12px;border-radius:var(--dsw-radius-lg);border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0;font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
			'.sm_ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.sm_ghost:disabled{cursor:default;opacity:.45}',
			'.sm_iconBtn{border:0;border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;justify-content:center;align-items:center;width:28px;height:28px;padding:0;display:flex}',
			'.sm_iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.sm_iconBtn:disabled{cursor:default;opacity:.45}',
			'.sm_fileInput{display:none}',
			'.sm_searchRow{flex:none;padding:0 20px 8px}',
			'.sm_search{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);width:100%;outline:0;padding:6px 10px;font:inherit;font-size:13px;line-height:20px}',
			'.sm_search::placeholder{color:var(--dsw-alias-label-caption)}',
			'.sm_search:focus{border-color:var(--dsw-alias-border-l3)}',
			'.sm_tabs{border-bottom:.5px solid var(--dsw-alias-border-l1);flex-wrap:wrap;flex:none;gap:4px;padding:0 20px 8px;display:flex}',
			'.sm_tab{border:.5px solid transparent;border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;gap:6px;padding:4px 12px;font:inherit;font-size:12.5px;line-height:18px;display:flex}',
			'.sm_tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.sm_tabActive{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}',
			'.sm_tabCount{color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}',
			'.sm_tabActive .sm_tabCount{color:var(--dsw-alias-label-tertiary)}',
			'.sm_notice{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);align-items:center;gap:8px;margin:0 20px 8px;padding:8px 12px;font-size:12px;line-height:18px;display:flex}',
			'.sm_noticeError{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent)}',
			'.sm_errorText{word-break:break-word}',
			'.sm_link{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:var(--dsw-radius-sm);padding:2px 4px;font:inherit;font-size:12px;line-height:18px;text-decoration:none}',
			'.sm_link:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
			'.sm_body{flex:1;min-height:0;gap:12px;padding:12px 20px 20px;display:flex}',
			'.sm_list{flex-direction:column;gap:6px;flex:1;min-width:0;min-height:0;display:flex;overflow-y:auto}',
			'.sm_loading,.sm_empty{color:var(--dsw-alias-label-caption);padding:18px 4px;font-size:13px;line-height:20px}',
			'.sm_card{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);align-items:center;display:flex;position:relative}',
			'.sm_card:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.sm_cardActive{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover))}',
			'.sm_cardOpen{text-align:left;background:0 0;border:0;flex-direction:column;flex:1;gap:3px;min-width:0;padding:8px 10px;font:inherit;cursor:pointer;display:flex}',
			'.sm_cardTop{align-items:center;gap:8px;min-width:0;display:flex}',
			'.sm_cardName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-size:13px;line-height:18px;overflow:hidden}',
			'.sm_cardMeta{color:var(--dsw-alias-label-caption);align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:16px;display:flex}',
			'.sm_cardDetail{font-variant-numeric:tabular-nums}',
			'.sm_cardSnippet{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;max-width:100%;font-family:var(--ds-font-family-code,monospace);font-size:11.5px;line-height:16px;overflow:hidden}',
			'.sm_badge{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);flex:none;padding:0 6px;font-size:11px;line-height:18px}',
			'.sm_badgeSource{color:var(--dsw-alias-label-caption)}',
			'.sm_cardDelete{color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;background:0 0;border:0;border-radius:999px;flex:none;width:22px;height:22px;margin-right:6px;padding:0;font-size:15px;line-height:18px}',
			'.sm_card:hover .sm_cardDelete,.sm_cardDelete:focus-visible{opacity:1}',
			'.sm_cardDelete:hover{background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-state-error-primary)}',
			'.sm_preview{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);flex-direction:column;gap:8px;flex:none;width:min(340px,42%);min-height:0;padding:10px 12px;display:flex;overflow-y:auto}',
			'.sm_previewEmpty{color:var(--dsw-alias-label-caption);justify-content:center;align-items:center;font-size:12px;line-height:18px}',
			'.sm_previewHead{flex-direction:column;gap:4px;min-width:0;display:flex}',
			'.sm_previewTitle{color:var(--dsw-alias-label-primary);word-break:break-word;font-size:13px;font-weight:500;line-height:18px}',
			'.sm_previewMeta{color:var(--dsw-alias-label-caption);align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:16px;display:flex}',
			'.sm_previewImage{border-radius:var(--dsw-radius-md);object-fit:contain;background:var(--dsw-alias-bg-layer-2);max-width:100%;max-height:320px}',
			'.sm_previewText{background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;margin:0;padding:8px 10px;font-family:var(--ds-font-family-code,monospace);font-size:11.5px;line-height:16px;max-height:320px;overflow:auto}',
			'.sm_toasts{z-index:1100;flex-direction:column;gap:8px;align-items:flex-end;display:flex;position:fixed;right:16px;bottom:16px;pointer-events:none}',
			'.sm_toast{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent,var(--dsw-elevation-panel));color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;align-items:center;gap:10px;width:min(320px,calc(100vw - 32px));padding:10px 12px;font:inherit;display:flex;pointer-events:auto;animation:sm_toast_in .18s ease-out}',
			'@keyframes sm_toast_in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
			'@media (prefers-reduced-motion:reduce){.sm_toast{animation:none}}',
			'.sm_toastMark{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-layer-1);border-radius:999px;flex:none;justify-content:center;align-items:center;width:26px;height:26px;display:flex}',
			'.sm_toastBody{flex-direction:column;flex:1;gap:1px;min-width:0;display:flex}',
			'.sm_toastTitle{color:var(--dsw-alias-label-caption);font-size:11px;line-height:15px}',
			'.sm_toastName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:18px;overflow:hidden}',
			'.sm_toastMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}',
			'.sm_toastClose{color:var(--dsw-alias-label-caption);flex:none;font-size:15px;line-height:18px}',
			'.sm_drop{background:color-mix(in srgb, var(--dsw-alias-bg-base) 70%, transparent);z-index:40;justify-content:center;align-items:center;display:flex;position:absolute;inset:0}',
			'.sm_dropCard{border:1.5px dashed var(--dsw-alias-brand-primary);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:6px;padding:28px 40px;font-size:13px;line-height:20px;display:flex}',
			'.sm_ghost:focus-visible,.sm_link:focus-visible,.sm_iconBtn:focus-visible,.sm_tab:focus-visible,.sm_cardOpen:focus-visible,.sm_cardDelete:focus-visible,.sm_search:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
			'@media (max-width:720px){.sm_body{flex-direction:column}.sm_preview{width:100%;max-height:280px}}',
		].join('');
		//#endregion

		//#region plugin body
		/**
		 * Register the sidebar entry, the panel, the dictionaries, and the styles.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(
				() => ctx.locale.register(NS, { zh, en }),
				'superman: dictionaries',
			);
			ctx.effect(() => {
				const selector = `style[data-plugin-css="${PKG}/superman.css"]`;
				document.querySelector(selector)?.remove();
				const tag = document.createElement('style');
				tag.dataset.plugin = PKG;
				tag.dataset.pluginCss = `${PKG}/superman.css`;
				tag.textContent = css;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, 'superman: styles');
			const notifier = createNotifier();
			const memory = createMemory(t, (item) => notifier.notify(item));
			ctx.effect(() => () => memory.dispose(), 'superman: memory controller');
			const watcher = createWatcher(
				(item) => notifier.notify(item),
				() => void memory.actions.load(),
			);
			ctx.effect(() => () => watcher.dispose(), 'superman: memory watcher');
			ctx.slots.inject('shell.overlay', () => ctx.slots.register({
				name: 'shell.overlay',
				id: 'superman.toast',
				locale: NS,
				inject: () => ({
					hooks: { toasts: notifier.store },
					dismiss: notifier.dismiss,
					openPanel: () => ctx.get?.('layout')?.selectPanel?.(PANEL_ID),
				}),
			}, ToastStack));
			ctx.slots.inject('main', () => ctx.slots.register({
				name: 'main',
				key: PANEL_ID,
				locale: NS,
				inject: () => ({
					hooks: { store: memory.store },
					...memory.actions,
				}),
			}, Panel));
			ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
				name: 'sidebar.panellist',
				id: PANEL_ID,
				order: -5,
				label: () => t('panel'),
				locale: NS,
			}, PanelIcon));
		}
		//#endregion

		/** Helpers the offline check script drives directly; the page never reads them. */
		const internal = {
			zh,
			en,
			TABS,
			createStore,
			formatBytes,
			relativeTime,
			categoryKey,
			sourceLabel,
			noteTitle,
			noteKind,
			tabCounts,
			selectVisible,
			encodeBase64,
			createNotifier,
			createWatcher,
			memoryRequest,
			ToastStack,
			ItemCard,
			NoteCard,
			Preview,
			Panel,
			PanelIcon,
			css,
		};
		return { PKG, NS, PANEL_ID, inject, apply, internal };
	},
});

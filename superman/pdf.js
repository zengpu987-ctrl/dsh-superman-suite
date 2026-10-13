/**
 * PDF text extraction for the Superman memory's host half.
 *
 * This is a straight port of the browser half's extractor in
 * `chat-mode/client.js` (search `extractPdfText`): the page has no PDF library,
 * so it reads the file itself — it walks the object table, decodes the streams it
 * needs with the platform's `DecompressionStream`, maps glyph codes through each
 * font's `/ToUnicode` CMap, and replays the text operators of every page's
 * content stream. Apart from the two exported caps and their option names it is
 * line for line the shipped browser code, so the two halves cannot drift apart;
 * `tools/superman-host-check.mjs` loads the browser copy through
 * `tools/chat-mode-load.mjs` and asserts both produce identical text for the
 * same real PDFs.
 *
 * Nothing DOM-specific remains: in Node the globals it needs (`DecompressionStream`,
 * `Response`, `TextDecoder`) are all present, and it only ever handles bytes.
 *
 * Every step is tolerant: an unsupported filter, a composite font without a
 * CMap, or a damaged object loses only what it covers, and a document whose
 * text cannot be recovered reports that (`note`) instead of inventing it (a
 * scanned PDF has no text layer at all).
 */

/** Cap on one decoded stream, so a decompression bomb cannot exhaust memory. */
const MAX_PDF_STREAM_BYTES = 8 * 1024 * 1024;
/** Most pages the host replays out of one stored PDF. */
export const MAX_PDF_PAGES = 200;
/** Longest PDF body the host keeps for recall, in characters. */
export const MAX_PDF_TEXT_CHARS = 400_000;

function byteString(bytes) {
	let out = '';
	const step = 0x8000;
	for (let index = 0; index < bytes.length; index += step) {
		out += String.fromCharCode.apply(null, bytes.subarray(index, index + step));
	}
	return out;
}

/** Turn a one-byte-per-character string back into bytes. */
function bytesOf(text) {
	const out = new Uint8Array(text.length);
	for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
	return out;
}

/** Decode bytes that carry single-byte text in the encoding PDFs usually use. */
function singleByteText(bytes) {
	try {
		return new TextDecoder('windows-1252').decode(bytes);
	} catch {
		return byteString(bytes);
	}
}

/** How much of a candidate decoding reads as CJK script. */
function cjkRatio(text) {
	if (text === '') return 0;
	let cjk = 0;
	for (const character of text) {
		const code = character.codePointAt(0);
		if (code >= 0x3400 && code <= 0x9fff || code >= 0xf900 && code <= 0xfaff || code >= 0x3040 && code <= 0x30ff) cjk += 1;
	}
	return cjk / [...text].length;
}

/**
 * Decode one CMap-less font's bytes. Some producers embed Chinese text in a
 * font declared `WinAnsiEncoding`, where the bytes are really GBK; when most
 * bytes are high and a CJK decoding reads as real script, that decoding wins.
 * @param bytes - the drawn bytes.
 * @returns the decoded text.
 */
function decodeSingleByte(bytes) {
	const plain = singleByteText(bytes);
	if (bytes.length < 6) return plain;
	let high = 0;
	for (const byte of bytes) if (byte >= 0x80) high += 1;
	if (high / bytes.length <= 0.6) return plain;
	for (const label of ['gbk', 'big5', 'shift_jis']) {
		try {
			const candidate = new TextDecoder(label).decode(bytes);
			if (candidate !== plain && cjkRatio(candidate) > 0.5 && cjkRatio(candidate) > cjkRatio(plain)) return candidate;
		} catch {
			/* this build does not know the label */
		}
	}
	return plain;
}

/**
 * Inflate zlib or raw deflate bytes with the platform's own decoder.
 *
 * PDF streams routinely carry padding after the compressed data, which the
 * platform decoder reports as trailing junk and rejects. Reading the stream
 * by hand keeps everything it produced before that point, which is the
 * complete decoded data.
 * @param bytes - the stored stream bytes.
 * @returns the decoded bytes, or undefined when the framing is wrong.
 */
async function inflateBytes(bytes) {
	if (typeof DecompressionStream !== 'function') return undefined;
	for (const format of ['deflate', 'deflate-raw']) {
		let reader;
		try {
			reader = new Response(bytes).body.pipeThrough(new DecompressionStream(format)).getReader();
		} catch {
			continue;
		}
		const chunks = [];
		let total = 0;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done === true) break;
				if (value === undefined) continue;
				total += value.length;
				if (total > MAX_PDF_STREAM_BYTES) {
					await reader.cancel();
					break;
				}
				chunks.push(value);
			}
		} catch {
			/* trailing junk after the compressed data: everything read so far is the stream */
		}
		if (total > 0) {
			const out = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				out.set(chunk, offset);
				offset += chunk.length;
			}
			return out;
		}
	}
	return undefined;
}

/** Decode `/ASCII85Decode` bytes. */
function ascii85Bytes(text) {
	const body = text.replace(/^\s*<~/, '').replace(/~>\s*$/, '');
	const out = [];
	let group = [];
	const flush = () => {
		let value = 0;
		for (const digit of group) value = value * 85 + digit;
		out.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
		group = [];
	};
	for (const character of body) {
		if (character === 'z' && group.length === 0) {
			out.push(0, 0, 0, 0);
			continue;
		}
		const digit = character.charCodeAt(0) - 33;
		if (digit < 0 || digit > 84) continue;
		group.push(digit);
		if (group.length === 5) flush();
	}
	if (group.length > 1) {
		while (group.length < 5) group.push(84);
		flush();
	}
	return new Uint8Array(out);
}

/** Decode `/ASCIIHexDecode` bytes. */
function asciiHexBytes(text) {
	const clean = text.replace(/[^0-9A-Fa-f]/g, '');
	const out = new Uint8Array(Math.floor(clean.length / 2));
	for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
	return out;
}

/** Apply the filters a stream declares, in reverse (decode) order. */
async function decodeStream(raw, filters) {
	let data = raw;
	for (const filter of [...filters].reverse()) {
		if (filter === 'FlateDecode' || filter === 'Fl') {
			const next = await inflateBytes(data);
			if (next === undefined) return undefined;
			data = next;
			continue;
		}
		if (filter === 'ASCII85Decode' || filter === 'A85') {
			data = ascii85Bytes(byteString(data));
			continue;
		}
		if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
			data = asciiHexBytes(byteString(data));
			continue;
		}
		return undefined;
	}
	if (filters.length === 0 && data.length > 2 && data[0] === 0x78) {
		const next = await inflateBytes(data);
		if (next !== undefined) return next;
	}
	return data;
}

/** The index just past one literal string `(...)`. */
function skipLiteral(text, index) {
	let depth = 0;
	for (let cursor = index; cursor < text.length; cursor += 1) {
		const character = text[cursor];
		if (character === '\\') {
			cursor += 1;
			continue;
		}
		if (character === '(') depth += 1;
		else if (character === ')') {
			depth -= 1;
			if (depth === 0) return cursor + 1;
		}
	}
	return text.length;
}

/** The index just past the balanced `<<...>>`, `[...]`, or `(...)` at `index`. */
function balancedEnd(text, index) {
	const opener = text[index];
	if (opener === '(') return skipLiteral(text, index);
	if (opener === '<' && text[index + 1] !== '<') {
		const stop = text.indexOf('>', index);
		return stop === -1 ? text.length : stop + 1;
	}
	const pair = opener === '[' ? [index, '[', ']'] : [index, '<<', '>>'];
	let depth = 0;
	for (let cursor = pair[0]; cursor < text.length - (pair[2].length - 1); cursor += 1) {
		const character = text[cursor];
		if (pair[2] === '>>') {
			if (character === '<' && text[cursor + 1] === '<') {
				depth += 1;
				cursor += 1;
				continue;
			}
			if (character === '>' && text[cursor + 1] === '>') {
				depth -= 1;
				cursor += 1;
				if (depth === 0) return cursor + 1;
			}
			continue;
		}
		if (character === '(') {
			cursor = skipLiteral(text, cursor) - 1;
			continue;
		}
		if (character === '<' && text[cursor + 1] === '<') {
			cursor = balancedEnd(text, cursor) - 1;
			continue;
		}
		if (character === '[') depth += 1;
		else if (character === ']') {
			depth -= 1;
			if (depth === 0) return cursor + 1;
		}
	}
	return text.length;
}

/**
 * The one complete value that follows a dictionary key: a nested dictionary,
 * an array, a literal string, a name, a reference, or a number. Reading only
 * the token keeps the keys that follow it out of the value.
 * @param dict - the dictionary's text.
 * @param key - the key to read, without its slash.
 * @returns the value text, or undefined when the key is absent.
 */
function valueAt(dict, key) {
	const found = new RegExp(`/${key}(?![A-Za-z0-9])`).exec(dict);
	if (found === null) return undefined;
	const rest = dict.slice(found.index + found[0].length);
	let index = 0;
	while (index < rest.length && /\s/.test(rest[index])) index += 1;
	const head = rest[index];
	if (head === undefined) return undefined;
	if (head === '<' || head === '[' || head === '(') return rest.slice(index, balancedEnd(rest, index));
	if (head === '/') {
		const name = /^\/[^\s/<>[\]()]+/.exec(rest.slice(index));
		return name === null ? undefined : name[0];
	}
	const reference = /^\d+\s+\d+\s+R(?![0-9])/.exec(rest.slice(index));
	if (reference !== null) return reference[0];
	const number = /^[+-]?[\d.]+/.exec(rest.slice(index));
	return number === null ? undefined : number[0];
}

/** A name value (`/Foo`) of one dictionary key. */
function nameAt(dict, key) {
	const value = valueAt(dict, key);
	const found = value === undefined ? null : /^\/([^\s/<>[\]()]+)/.exec(value);
	return found === null ? undefined : found[1];
}

/** A direct-number value of one dictionary key. */
function numberAt(dict, key) {
	const value = valueAt(dict, key);
	const found = value === undefined ? null : /^(\d+)/.exec(value);
	return found === null ? undefined : Number(found[1]);
}

/** An indirect reference (`12 0 R`) value of one dictionary key. */
function refAt(dict, key) {
	const value = valueAt(dict, key);
	const found = value === undefined ? null : /^(\d+)\s+\d+\s+R(?![0-9])/.exec(value);
	return found === null ? undefined : Number(found[1]);
}

/** Every indirect reference inside one array-shaped dictionary value. */
function refsAt(dict, key) {
	const value = valueAt(dict, key);
	if (value === undefined) return [];
	const body = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
	const refs = [];
	const pattern = /(\d+)\s+\d+\s+R(?![0-9])/g;
	let match = pattern.exec(body);
	while (match !== null) {
		refs.push(Number(match[1]));
		match = pattern.exec(body);
	}
	return refs;
}

/** The `<<...>>` body of one dictionary key, when it is inline. */
function inlineDictAt(dict, key) {
	const value = valueAt(dict, key);
	return value !== undefined && value.startsWith('<<') && value.endsWith('>>') ? value.slice(2, -2) : undefined;
}

/** Filter names declared by a dictionary's `/Filter`, in declared order. */
function filtersAt(dict) {
	const value = valueAt(dict, 'Filter');
	if (value === undefined) return [];
	const names = value.match(/\/([A-Za-z0-9]+)/g);
	return names === null ? [] : names.map((name) => name.slice(1));
}

/** Whether a stream holds raster data rather than page content. */
function looksLikeImage(dict) {
	if (nameAt(dict, 'Subtype') === 'Image') return true;
	return filtersAt(dict).some((filter) => ['DCTDecode', 'JPXDecode', 'CCITTFaxDecode', 'JBIG2Decode'].includes(filter));
}

/**
 * Walk one PDF's object table.
 * @param structure - the file as one-byte-per-character text.
 * @returns objects in file order, each with its dictionary text and raw stream bytes.
 */
function scanObjects(structure) {
	const objects = [];
	const pattern = /(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
	let cursor = 0;
	let match = pattern.exec(structure);
	while (match !== null) {
		if (match.index < cursor) {
			match = pattern.exec(structure);
			continue;
		}
		const bodyStart = match.index + match[0].length;
		const endObject = structure.indexOf('endobj', bodyStart);
		const streamAt = structure.indexOf('stream', bodyStart);
		const hasStream = streamAt !== -1 && (endObject === -1 || streamAt < endObject) && structure.slice(bodyStart, streamAt).includes('>>');
		const dictEnd = hasStream ? streamAt : (endObject === -1 ? structure.length : endObject);
		const dict = structure.slice(bodyStart, dictEnd);
		let raw;
		let after = dictEnd;
		if (hasStream) {
			let dataStart = streamAt + 'stream'.length;
			if (structure[dataStart] === '\r') dataStart += 1;
			if (structure[dataStart] === '\n') dataStart += 1;
			/* An indirect `/Length 12 0 R` cannot be read here, so `endstream` locates the data. */
			const declared = refAt(dict, 'Length') === undefined ? numberAt(dict, 'Length') : undefined;
			const stop = structure.indexOf('endstream', dataStart);
			let length = declared === undefined ? -1 : declared;
			if (length < 0 || dataStart + length > structure.length || (stop !== -1 && dataStart + length > stop)) {
				length = stop === -1 ? structure.length - dataStart : stop - dataStart;
			}
			raw = bytesOf(structure.slice(dataStart, dataStart + length));
			after = dataStart + length;
		}
		objects.push({ number: Number(match[1]), dict, raw });
		cursor = after;
		match = pattern.exec(structure);
	}
	return objects;
}

/** Decode a UTF-16BE hex string from a CMap. */
function unicodeFromHex(hex) {
	let out = '';
	for (let index = 0; index + 3 < hex.length + 1; index += 4) {
		const chunk = hex.slice(index, index + 4);
		if (chunk.length < 4) break;
		out += String.fromCharCode(Number.parseInt(chunk, 16));
	}
	return out === '' ? String.fromCharCode(Number.parseInt(hex, 16) || 0) : out;
}

/** Parse one `/ToUnicode` CMap into a code-to-text map. */
function parseCMap(text) {
	const map = new Map();
	const characters = /beginbfchar([\s\S]*?)endbfchar/g;
	let block = characters.exec(text);
	while (block !== null) {
		const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
		let match = pair.exec(block[1]);
		while (match !== null) {
			map.set(Number.parseInt(match[1], 16), unicodeFromHex(match[2]));
			match = pair.exec(block[1]);
		}
		block = characters.exec(text);
	}
	const ranges = /beginbfrange([\s\S]*?)endbfrange/g;
	block = ranges.exec(text);
	while (block !== null) {
		const range = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
		let match = range.exec(block[1]);
		while (match !== null) {
			const low = Number.parseInt(match[1], 16);
			const high = Number.parseInt(match[2], 16);
			if (match[3] !== undefined) {
				const base = unicodeFromHex(match[3]);
				const last = base.charCodeAt(base.length - 1);
				for (let code = low; code <= high && code - low < 65536; code += 1) {
					map.set(code, base.slice(0, -1) + String.fromCharCode(last + (code - low)));
				}
			} else if (match[4] !== undefined) {
				const entries = match[4].match(/<[0-9A-Fa-f]+>/g) ?? [];
				entries.forEach((entry, offset) => {
					map.set(low + offset, unicodeFromHex(entry.slice(1, -1)));
				});
			}
			match = range.exec(block[1]);
		}
		block = ranges.exec(text);
	}
	return map;
}

/** Read one literal string `(...)` that starts at `index`. */
function readLiteralString(content, index) {
	const bytes = [];
	let depth = 1;
	let cursor = index + 1;
	while (cursor < content.length) {
		const character = content[cursor];
		if (character === '\\') {
			const next = content[cursor + 1];
			cursor += 2;
			if (next === 'n') bytes.push(10);
			else if (next === 'r') bytes.push(13);
			else if (next === 't') bytes.push(9);
			else if (next === 'b') bytes.push(8);
			else if (next === 'f') bytes.push(12);
			else if (next === '\n') continue;
			else if (next === '\r') {
				if (content[cursor] === '\n') cursor += 1;
			} else if (next >= '0' && next <= '7') {
				let octal = next;
				while (octal.length < 3 && content[cursor] >= '0' && content[cursor] <= '7') {
					octal += content[cursor];
					cursor += 1;
				}
				bytes.push(Number.parseInt(octal, 8) & 0xff);
			} else bytes.push((next ?? '').charCodeAt(0) & 0xff);
			continue;
		}
		if (character === '(') depth += 1;
		else if (character === ')') {
			depth -= 1;
			if (depth === 0) return { bytes: new Uint8Array(bytes), next: cursor + 1 };
		}
		bytes.push(character.charCodeAt(0) & 0xff);
		cursor += 1;
	}
	return { bytes: new Uint8Array(bytes), next: content.length };
}

/** Read one hexadecimal string `<...>` that starts at `index`. */
function readHexString(content, index) {
	const stop = content.indexOf('>', index);
	const body = stop === -1 ? content.slice(index + 1) : content.slice(index + 1, stop);
	const clean = body.replace(/[^0-9A-Fa-f]/g, '');
	const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
	const bytes = new Uint8Array(padded.length / 2);
	for (let offset = 0; offset < bytes.length; offset += 1) bytes[offset] = Number.parseInt(padded.slice(offset * 2, offset * 2 + 2), 16);
	return { bytes, next: stop === -1 ? content.length : stop + 1 };
}

/** Decode one drawn string through the active font's CMap. */
function decodeCodes(bytes, font) {
	if (font !== undefined && font.cmap !== undefined) {
		let out = '';
		if (font.twoByte === true) {
			for (let index = 0; index + 1 < bytes.length; index += 2) {
				out += font.cmap.get((bytes[index] << 8) | bytes[index + 1]) ?? '';
			}
		} else {
			for (const code of bytes) out += font.cmap.get(code) ?? '';
		}
		return out;
	}
	if (font !== undefined && font.twoByte === true) return '';
	return decodeSingleByte(bytes);
}

/**
 * Replay one content stream's text operators.
 * @param content - the decoded stream as one-byte-per-character text.
 * @param fontFor - resolves one resource font name to its decoding facts.
 * @returns the text the stream draws.
 */
function contentText(content, fontFor) {
	const out = [];
	let font;
	let stack = [];
	let index = 0;
	let lastY;
	const newline = () => {
		if (out.length > 0 && out[out.length - 1] !== '\n') out.push('\n');
	};
	while (index < content.length) {
		const character = content[index];
		if (character === '%') {
			const stop = content.indexOf('\n', index);
			index = stop === -1 ? content.length : stop + 1;
			continue;
		}
		if (character === '(') {
			const read = readLiteralString(content, index);
			stack.push({ bytes: read.bytes });
			index = read.next;
			continue;
		}
		if (character === '<' && content[index + 1] === '<') {
			index = balancedEnd(content, index);
			continue;
		}
		if (character === '<') {
			const read = readHexString(content, index);
			stack.push({ bytes: read.bytes });
			index = read.next;
			continue;
		}
		if (character === '[') {
			stack.push('[');
			index += 1;
			continue;
		}
		if (character === ']') {
			const items = [];
			while (stack.length > 0 && stack[stack.length - 1] !== '[') items.unshift(stack.pop());
			if (stack.length > 0) stack.pop();
			stack.push(items);
			index += 1;
			continue;
		}
		if (character === '/') {
			const found = /^\/([^\s/<>[\]()]+)/.exec(content.slice(index));
			stack.push({ name: found === null ? '' : found[1] });
			index += found === null ? 1 : found[0].length;
			continue;
		}
		if (character >= '0' && character <= '9' || character === '+' || character === '-' || character === '.') {
			const found = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(content.slice(index));
			if (found !== null) {
				stack.push(Number(found[0]));
				index += found[0].length;
				continue;
			}
			index += 1;
			continue;
		}
		const operator = /^[A-Za-z'"*]+/.exec(content.slice(index));
		if (operator === null) {
			index += 1;
			continue;
		}
		index += operator[0].length;
		const op = operator[0];
		if (op === 'ID') {
			const stop = content.indexOf('EI', index);
			index = stop === -1 ? content.length : stop + 2;
			stack = [];
			continue;
		}
		if (op === 'Tf') {
			const name = stack.find((value) => value !== null && typeof value === 'object' && value.name !== undefined);
			font = name === undefined ? undefined : fontFor(name.name);
		} else if (op === 'Tj' || op === "'" || op === '"') {
			if (op !== 'Tj') newline();
			const value = stack.filter((item) => item !== null && typeof item === 'object' && item.bytes !== undefined).pop();
			if (value !== undefined) out.push(decodeCodes(value.bytes, font));
		} else if (op === 'TJ') {
			const array = stack[stack.length - 1];
			if (Array.isArray(array)) {
				for (const item of array) {
					if (typeof item === 'number') {
						if (item <= -180) out.push(' ');
						continue;
					}
					if (item !== null && typeof item === 'object' && item.bytes !== undefined) out.push(decodeCodes(item.bytes, font));
				}
			}
		} else if (op === 'Td' || op === 'TD') {
			const numbers = stack.filter((item) => typeof item === 'number');
			const ty = numbers[numbers.length - 1];
			if (op === 'TD' || (ty !== undefined && ty !== 0)) newline();
		} else if (op === 'T*') {
			newline();
		} else if (op === 'Tm') {
			const numbers = stack.filter((item) => typeof item === 'number');
			const ty = numbers[numbers.length - 1];
			if (ty !== undefined && ty !== lastY) {
				newline();
				lastY = ty;
			}
		} else if (op === 'BT' || op === 'ET') newline();
		stack = [];
	}
	return out.join('');
}

/** Resolve the font resource names one page declares, walking up its parents. */
function resourceFontsOf(page, byNumber) {
	let current = page;
	for (let hop = 0; hop < 8 && current !== undefined; hop += 1) {
		const dict = current.dict;
		const resources = inlineDictAt(dict, 'Resources') ?? (() => {
			const ref = refAt(dict, 'Resources');
			return ref === undefined ? undefined : byNumber.get(ref)?.dict;
		})();
		const fontDict = resources === undefined ? undefined : inlineDictAt(resources, 'Font');
		if (fontDict !== undefined) {
			const map = new Map();
			const pattern = /\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R(?![0-9])/g;
			let match = pattern.exec(fontDict);
			while (match !== null) {
				map.set(match[1], Number(match[2]));
				match = pattern.exec(fontDict);
			}
			return map;
		}
		const parent = refAt(dict, 'Parent');
		current = parent === undefined ? undefined : byNumber.get(parent);
	}
	return undefined;
}

/** Whether one extracted line is mostly decoding noise rather than text. */
function looksLikeNoise(line) {
	if (line.length < 4) return false;
	let bad = 0;
	for (const character of line) {
		const code = character.codePointAt(0);
		if (code === 0xfffd || code >= 0x80 && code <= 0x9f || code < 32) bad += 1;
	}
	return bad / line.length > 0.4;
}

/** Tidy one page's extracted text, dropping lines that decoded into noise. */
function cleanupPdfText(text) {
	const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim());
	const out = [];
	for (const line of lines) {
		if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
		if (looksLikeNoise(line)) continue;
		out.push(line);
	}
	while (out.length > 0 && out[out.length - 1] === '') out.pop();
	return out.join('\n');
}

/** How much of a candidate extraction reads as human text. */
function textRatio(text) {
	if (text === '') return 0;
	let good = 0;
	for (const character of text) {
		const code = character.codePointAt(0);
		if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || (code >= 0x2000 && code <= 0x206f) || (code >= 0x3000 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)) good += 1;
	}
	return good / [...text].length;
}

/**
 * Read the objects one `/Type /ObjStm` stream contains.
 * @param text - the decoded stream.
 * @param dict - the stream's dictionary.
 * @returns the contained objects, with their dictionary text.
 */
function objStmObjects(text, dict) {
	const count = numberAt(dict, 'N');
	const first = numberAt(dict, 'First');
	if (count === undefined || first === undefined) return [];
	const header = text.slice(0, first).match(/\d+/g) ?? [];
	const entries = [];
	for (let index = 0; index + 1 < header.length && entries.length < count; index += 2) {
		entries.push({ number: Number(header[index]), offset: Number(header[index + 1]) });
	}
	const objects = [];
	for (const [index, entry] of entries.entries()) {
		const start = first + entry.offset;
		const stop = index + 1 < entries.length ? first + entries[index + 1].offset : text.length;
		if (start < first || stop <= start) continue;
		objects.push({ number: entry.number, dict: text.slice(start, stop), raw: undefined });
	}
	return objects;
}

/**
 * Extract the text of one PDF.
 * @param bytes - the whole file.
 * @param options - optional caps; the host passes `maxPages` and `maxTextChars`.
 *   Omitted (the browser half's call shape) both are unlimited, so the two
 *   halves agree byte for byte.
 * @returns a promise of the text, its page count, or the reason it is unavailable.
 */
export async function extractPdfText(bytes, options = {}) {
	const maxPages = Number.isFinite(options?.maxPages) && options.maxPages > 0 ? Math.floor(options.maxPages) : Infinity;
	const maxTextChars = Number.isFinite(options?.maxTextChars) && options.maxTextChars > 0 ? Math.floor(options.maxTextChars) : Infinity;
	const structure = byteString(bytes);
	if (!structure.includes('%PDF-')) return { text: '', note: 'not-pdf' };
	if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(structure)) return { text: '', note: 'encrypted' };
	const objects = scanObjects(structure);
	if (objects.length === 0) return { text: '', note: 'unreadable' };
	const decoded = new Map();
	for (const object of objects) {
		if (object.raw === undefined || looksLikeImage(object.dict)) continue;
		const result = await decodeStream(object.raw, filtersAt(object.dict));
		if (result === undefined || result.length === 0 || result.length > MAX_PDF_STREAM_BYTES) continue;
		decoded.set(object.number, result);
	}
	const cmaps = new Map();
	for (const [number, data] of decoded) {
		const text = byteString(data);
		if (text.includes('beginbfchar') || text.includes('beginbfrange')) cmaps.set(number, parseCMap(text));
	}
	const merged = new Map();
	for (const map of cmaps.values()) for (const [code, value] of map) if (!merged.has(code)) merged.set(code, value);
	/* Many modern files keep their page and font dictionaries inside object streams. */
	const contained = [];
	for (const object of objects) {
		const data = decoded.get(object.number);
		if (data === undefined || nameAt(object.dict, 'Type') !== 'ObjStm') continue;
		contained.push(...objStmObjects(byteString(data), object.dict));
	}
	const byNumber = new Map();
	const fonts = new Map();
	for (const object of [...objects, ...contained]) {
		byNumber.set(object.number, object);
		if (nameAt(object.dict, 'Type') === 'Font' || object.dict.includes('/BaseFont')) {
			const toUnicode = refAt(object.dict, 'ToUnicode');
			fonts.set(object.number, {
				twoByte: nameAt(object.dict, 'Subtype') === 'Type0',
				cmap: toUnicode === undefined ? undefined : cmaps.get(toUnicode),
			});
		}
	}
	const pages = [];
	for (const object of [...objects, ...contained]) {
		if (nameAt(object.dict, 'Type') !== 'Page') continue;
		const resourceFonts = resourceFontsOf(object, byNumber);
		const fontFor = (name) => {
			const declared = resourceFonts?.get(name);
			const own = declared === undefined ? undefined : fonts.get(declared);
			if (own !== undefined) return own;
			return { twoByte: false };
		};
		const pieces = [];
		for (const ref of refsAt(object.dict, 'Contents')) {
			const data = decoded.get(ref);
			if (data === undefined) continue;
			const text = cleanupPdfText(contentText(byteString(data), fontFor));
			if (text !== '') pieces.push(text);
		}
		const text = pieces.join('\n');
		if (text !== '') pages.push(text);
	}
	if (pages.length === 0) {
		/* No usable page tree: replay every stream that draws text, through the merged CMap. */
		const fontFor = () => ({ twoByte: true, cmap: merged.size === 0 ? undefined : merged });
		for (const object of objects) {
			const data = decoded.get(object.number);
			if (data === undefined) continue;
			const content = byteString(data);
			if (!content.includes('BT') || !content.includes('Tj') && !content.includes('TJ')) continue;
			const text = cleanupPdfText(contentText(content, fontFor));
			if (text !== '') pages.push(text);
		}
	}
	const kept = pages.length > maxPages ? pages.slice(0, maxPages) : pages;
	let text = kept.join('\n\n');
	if (text.length > maxTextChars) text = text.slice(0, maxTextChars);
	if (text.trim().length < 2) return { text: '', note: 'no-text', pages: kept.length };
	if (textRatio(text) < 0.75) return { text: '', note: 'unreadable', pages: kept.length };
	return { text, pages: kept.length };
}

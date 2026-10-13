/**
 * Measure the worked BM25 example Figure 8 needs.
 *
 * The v2 memory ranks with BM25 (`superman/index.js`, k1 = 1.2, b = 0.75,
 * name weight 3); v1 ranked with a flat additive score. Both scorers are run
 * here over one small synthetic two-document corpus, using the *shipped* v2
 * internals (`internal.documentVector`, `internal.idf`, `internal.bm25Rank`)
 * and an exact port of the v1 additive formula (`flatScore`, transcribed from
 * `git show 52b99e6:superman/index.js`, the `recall` loop).
 *
 * Usage: node papers/v2/tools/bm25-probe.mjs [suiteRoot]
 * Prints one JSON object on stdout; `metrics.py` embeds it in metrics.json.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const suiteRoot = process.argv[2] ?? join(import.meta.dirname, '..', '..', '..', 'dsh-superman-suite', 'v2');
const modulePath = join(suiteRoot, 'superman', 'index.js');
if (!existsSync(modulePath)) {
	console.error(`superman/index.js not found under ${suiteRoot}`);
	process.exit(2);
}
const { internal } = await import(modulePath);
const { tokenize, documentVector, bm25Rank } = internal;

/** One filler sentence body, so the long document is long without being noisy. */
const filler = (times) => Array.from({ length: times }, (_, index) => `section ${index} records the routine ledger entries and the quarterly totals for the archive`).join('. ');

/**
 * The synthetic corpus for the worked example.
 *
 * Both documents carry the common query term `memory`, so its document
 * frequency is 2 and its IDF is small; only the short document carries the
 * rare term `compaction`, so its IDF is three times larger. The long document
 * also repeats the common term 20 times in a long body — exactly what the flat
 * additive score rewards and what BM25's length normalisation discounts.
 */
const corpus = [
	{
		id: 'a',
		kind: 'item',
		name: 'memory-annual-report.pdf',
		// 20 occurrences of the common term in a long body; the rare term absent.
		text: `${filler(14)}. The memory holds the index. ${'the memory keeps the ledger. '.repeat(19)}`,
	},
	{
		id: 'b',
		kind: 'item',
		name: 'policy-note.txt',
		// The rare term twice, the common term once, in a body of one sentence.
		text: 'Compaction runs when the caps are reached. Compaction deletes the oldest entry. The memory stays bounded.',
	},
];
const query = 'memory compaction';
const NAME_WEIGHT = 3;

/**
 * The v1 flat additive score, transcribed from `52b99e6:superman/index.js`
 * (name hit 4, body hit 1.5 for a token of two characters or more, +0.5 when a
 * token occurs more than three times). The recency term is omitted: both
 * documents in this example are stamped identically, so it cancels.
 * @param document - one corpus row.
 * @param tokens - the query's tokens.
 * @returns the flat score.
 */
function flatScore(document, tokens) {
	const haystack = `${document.name}\n${document.text ?? ''}`.toLowerCase();
	const name = document.name.toLowerCase();
	let score = 0;
	for (const token of tokens) {
		if (name.includes(token)) score += 4;
		if (haystack.includes(token)) {
			score += token.length >= 2 ? 1.5 : 0.6;
			const occurrences = haystack.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? [];
			if (occurrences.length > 3) score += 0.5;
		}
	}
	return score;
}

const tokens = tokenize(query);
const documents = corpus.map((row) => ({
	...row,
	vector: documentVector([[row.name, NAME_WEIGHT], [row.text ?? '', 1]]),
}));

const flat = corpus.map((row) => flatScore(row, tokens));
const bm25 = documents.map((row) => {
	const ranked = bm25Rank(documents, tokens).find((entry) => documents[entry.index].id === row.id);
	return ranked === undefined ? 0 : ranked.score;
});

/** Ranks (1 = best) for one score vector, ties broken by corpus order. */
const ranks = (scores) => scores.map((score) => 1 + scores.filter((other) => other > score).length);

const flatRanks = ranks(flat);
const bm25Ranks = ranks(bm25);
const idf = tokens.map((token) => {
	const documentFrequency = documents.filter((row) => row.vector.frequency.has(token)).length;
	return { token, documentFrequency, documents: documents.length, idf: internal.idf(documentFrequency, documents.length) };
});

const result = {
	query,
	tokens,
	corpus: documents.map((row, index) => ({
		id: row.id,
		label: row.name,
		bodyLength: row.vector.length,
		terms: tokens.map((token) => ({ token, frequency: row.vector.frequency.get(token) ?? 0 })),
		flatScore: Number(flat[index].toFixed(3)),
		flatRank: flatRanks[index],
		bm25Score: Number(bm25[index].toFixed(3)),
		bm25Rank: bm25Ranks[index],
	})),
	idf,
	rankFlip: flatRanks[0] !== bm25Ranks[0],
	flatWinner: corpus[flatRanks.indexOf(1)].name,
	bm25Winner: corpus[bm25Ranks.indexOf(1)].name,
};

console.log(JSON.stringify(result, null, 1));

// Trigram similarity (Dice coefficient) — pg_trgm-standard fuzzy match.
// Notes search zero-result safety net. Mirror of web-app/src/utils/trigram.ts.
export function triSet(s) {
  const t = `  ${String(s).toLowerCase().trim()} `;
  const out = new Set();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}
export function diceSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return (2 * inter) / (a.size + b.size);
}
export function fuzzyRank(query, items, threshold = 0.3) {
  const q = triSet(query);
  return items
    .map((it) => ({ id: it.id, score: diceSimilarity(q, triSet(it.text)) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.id);
}

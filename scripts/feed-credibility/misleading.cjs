// A post is misleading when Credibility Analyzer marks the verdict misleading
// or marks at least one claim false_misleading.
function isMisleading(row) {
  if (!row || !row.score) return false;
  const verdict = String(row.verdict || '');
  const statuses = row.findingStatuses || [];
  return /mislead/i.test(verdict) || statuses.includes('false_misleading');
}

function misleadingCount(list, scoreOf) {
  const scored = list.filter((t) => scoreOf(t.id)?.score);
  const misleading = scored.filter((t) => isMisleading(scoreOf(t.id)));
  return { scored: scored.length, misleading: misleading.length };
}

module.exports = { isMisleading, misleadingCount };

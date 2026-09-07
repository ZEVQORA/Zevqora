/**
 * Minimal unified diff (LCS-based) for single-file replacements. Enough for a
 * reviewer to read what a candidate changed; the desktop engine uses git for
 * the same view.
 */
function lcsTable(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/** Returns [op, line] pairs with op in {' ', '-', '+'}. */
export function diffLines(oldText, newText) {
  const a = String(oldText).replace(/\r\n/g, '\n').split('\n');
  const b = String(newText).replace(/\r\n/g, '\n').split('\n');
  if (a.length * b.length > 4_000_000) {
    // Too large for an exact LCS; fall back to whole-file replacement.
    return [...a.map((l) => ['-', l]), ...b.map((l) => ['+', l])];
  }
  const dp = lcsTable(a, b);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push([' ', a[i]]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(['-', a[i]]);
      i += 1;
    } else {
      out.push(['+', b[j]]);
      j += 1;
    }
  }
  while (i < a.length) out.push(['-', a[i++]]);
  while (j < b.length) out.push(['+', b[j++]]);
  return out;
}

export function unifiedDiff(path, oldText, newText, context = 3) {
  const ops = diffLines(oldText, newText);
  if (!ops.some(([op]) => op !== ' ')) return '';
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  let i = 0;
  while (i < ops.length) {
    if (ops[i][0] === ' ') {
      i += 1;
      continue;
    }
    let start = Math.max(0, i - context);
    let end = i;
    let gap = 0;
    while (end < ops.length && gap <= context * 2) {
      if (ops[end][0] === ' ') gap += 1;
      else gap = 0;
      end += 1;
    }
    end = Math.min(ops.length, end);
    while (end > i && ops[end - 1][0] === ' ' && end - i > context) end -= 1;
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < start; k += 1) {
      if (ops[k][0] !== '+') oldStart += 1;
      if (ops[k][0] !== '-') newStart += 1;
    }
    let oldCount = 0;
    let newCount = 0;
    for (let k = start; k < end; k += 1) {
      if (ops[k][0] !== '+') oldCount += 1;
      if (ops[k][0] !== '-') newCount += 1;
    }
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let k = start; k < end; k += 1) lines.push(`${ops[k][0]}${ops[k][1]}`);
    i = end;
  }
  return lines.join('\n') + '\n';
}

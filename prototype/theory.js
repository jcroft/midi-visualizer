// Pure chord / key / prediction logic for the mockup. No DOM.
const PC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const mod12 = (n) => ((n % 12) + 12) % 12;

// req: must be present; opt: extensions that cost little; base: quality family
const TEMPLATES = [
  { q: 'maj7', req: [4, 11], opt: [7, 2, 9, 6], prior: 0 },
  { q: '6', req: [4, 9], opt: [7, 2], prior: -0.15 },
  { q: 'm7', req: [3, 10], opt: [7, 2, 5, 9], prior: 0 },
  { q: 'm6', req: [3, 9], opt: [7, 2], prior: -0.2 },
  { q: 'mMaj7', req: [3, 11], opt: [7, 2], prior: -0.3 },
  { q: '7', req: [4, 10], opt: [7, 2, 9, 1, 3, 8, 6], prior: 0 },
  { q: 'm7b5', req: [3, 6, 10], opt: [2, 5, 8], prior: 0.1 },
  { q: 'dim7', req: [3, 6, 9], opt: [2, 11], prior: 0.1 },
  { q: '7sus4', req: [5, 10], opt: [7, 2, 9], prior: -0.2 },
  { q: 'maj', req: [4, 7], opt: [2, 9], prior: -0.5 },
  { q: 'min', req: [3, 7], opt: [2], prior: -0.5 },
];

const ROOTLESS = {
  m7: [[3, 7, 10, 2], [3, 10, 2]],
  '7': [[4, 9, 10, 2], [4, 10, 2, 7], [4, 10, 2], [4, 9, 10]],
  maj7: [[4, 7, 11, 2], [4, 11, 2], [4, 7, 9, 2]],
};
const has0 = (w) => w(0) > 0.3;

// Lead-sheet text for a quality given which extensions are present.
function qualityText(q, has) {
  switch (q) {
    case 'maj7':
      if (has(6)) return has(2) ? 'Δ9(♯11)' : 'Δ7(♯11)';
      return has(2) ? 'Δ9' : 'Δ7';
    case '6': return has(2) ? '6/9' : '6';
    case 'm7':
      if (has(5)) return '–11';
      return has(2) ? '–9' : '–7';
    case 'm6': return '–6';
    case 'mMaj7': return '–Δ7';
    case '7': {
      const alts = [1, 3, 8].filter(has).length + (has(6) && !has(7) ? 1 : 0);
      if (alts >= 2) return '7alt';
      const altTxt = [has(1) && '♭9', has(3) && '♯9', has(6) && '♯11', has(8) && '♭13'].filter(Boolean);
      if (altTxt.length) return '7(' + altTxt.join('') + ')';
      if (has(9)) return '13';
      return has(2) ? '9' : '7';
    }
    case 'm7b5': return 'ø7';
    case 'dim7': return '°7';
    case '7sus4': return has(9) ? '13sus' : has(2) ? '9sus' : '7sus4';
    case 'maj': return '';
    case 'min': return '–';
  }
  return q;
}

// Roman numeral relative to a major key.
const DEGREES = { 0: 'I', 1: '♭II', 2: 'II', 3: '♭III', 4: 'III', 5: 'IV', 6: '♯IV', 7: 'V', 8: '♭VI', 9: 'VI', 10: '♭VII', 11: 'VII' };
function roman(root, q, key) {
  let r = DEGREES[mod12(root - key)];
  const minorish = ['m7', 'm6', 'mMaj7', 'min', 'm7b5', 'dim7'].includes(q);
  if (minorish) r = r.toLowerCase();
  const suf = { maj7: 'Δ7', '6': '6', m7: '7', m6: '6', mMaj7: 'Δ7', '7': '7', m7b5: 'ø7', dim7: '°7', '7sus4': '7sus', maj: '', min: '' }[q];
  return r + suf;
}

/**
 * Score every (root, template) against a pitch-class pool.
 * pool: Float array[12] of weights 0..1; bass: pc or null; ctx: {prev:{root,q}|null, key}
 * Returns ranked candidates [{root, q, name, score, conf}].
 */
function recognize(pool, bass, ctx) {
  const active = [];
  for (let pc = 0; pc < 12; pc++) if (pool[pc] > 0.3) active.push(pc);
  if (active.length < 2) return [];
  const total = active.reduce((s, pc) => s + pool[pc], 0);
  const cands = [];
  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      const w = (iv) => pool[mod12(root + iv)];
      let missing = 0, reqW = 0;
      for (const iv of t.req) { reqW += w(iv); if (w(iv) < 0.3) missing++; }
      if (missing) continue;
      let explained = w(0) + reqW;
      let optW = 0;
      for (const iv of t.opt) optW += w(iv);
      explained += optW;
      const unexplained = Math.max(0, total - explained);
      let score = reqW * 2 + optW * 0.45 + w(0) * 0.9 - unexplained * 2.2 + t.prior;
      // Rootless A/B voicings (3-5-7-9, 3-13-7-9): the pianist's root is implied.
      const rel = new Set(active.map((pc) => mod12(pc - root)));
      const isForm = (form) => rel.size === form.length && form.every((iv) => rel.has(iv));
      if (!has0(w) && ROOTLESS[t.q] && ROOTLESS[t.q].some(isForm)) score += 1.3;
      if (t.q === 'maj7' && w(6) > 0.3) score -= 0.35; // ♯11 is rarer than a rootless reading
      if (bass != null) {
        if (bass === root) score += 0.9;
        else if (![...t.req, ...t.opt].includes(mod12(bass - root))) score -= 0.6;
      }
      if (ctx && ctx.prev) {
        const motion = mod12(root - ctx.prev.root);
        if (motion === 5) {
          score += 0.5; // down a fifth
          if (['m7', 'm7b5'].includes(ctx.prev.q) && t.q === '7') score += 0.9; // ii–V
          if (ctx.prev.q === '7' && ['maj7', '6', 'm7', 'maj'].includes(t.q)) score += 0.6; // V–I
        }
        if (motion === 11 && ctx.prev.q === '7' && ['maj7', '6'].includes(t.q)) score += 0.4; // tritone-sub resolution
      }
      if (ctx && ctx.key != null) {
        const deg = mod12(root - ctx.key);
        const diatonic = { 0: ['maj7', '6', 'maj'], 2: ['m7', 'min'], 4: ['m7', 'min'], 5: ['maj7', '6', 'maj'], 7: ['7', 'maj', '7sus4'], 9: ['m7', 'min'], 11: ['m7b5'] }[deg];
        if (diatonic && diatonic.includes(t.q)) score += 0.3;
      }
      const has = (iv) => w(iv) > 0.3;
      let name = PC_NAMES[root] + qualityText(t.q, has);
      if (bass != null && bass !== root && !t.req.includes(mod12(bass - root)) && mod12(bass - root) !== 7) {
        name += '/' + PC_NAMES[bass];
      }
      cands.push({ root, q: t.q, name, score, rootPlayed: has(0) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  // Softmax-ish confidence over the top few.
  const top = cands.slice(0, 4);
  const z = top.reduce((s, c) => s + Math.exp(c.score * 1.6), 0);
  top.forEach((c) => (c.conf = Math.exp(c.score * 1.6) / z));
  return cands; // ranked; conf set on the top four
}

// Local key from functional patterns over chord events (most recent last).
function inferKey(events, current) {
  const ev = events.slice(-3);
  const last = ev[ev.length - 1], prev = ev[ev.length - 2];
  if (!last) return current;
  if (prev && ['m7', 'm7b5'].includes(prev.q) && last.q === '7' && mod12(last.root - prev.root) === 5) {
    return { key: mod12(last.root + 5), implied: true };
  }
  if (prev && prev.q === '7' && ['maj7', '6', 'maj'].includes(last.q) && [5, 11].includes(mod12(last.root - prev.root))) {
    return { key: last.root, implied: false };
  }
  if (['maj7', '6'].includes(last.q) && current.implied && current.key === last.root) {
    return { key: last.root, implied: false };
  }
  return current;
}

function predict(chord, key) {
  if (!chord) return [];
  const r = chord.root;
  const P = (dr, q, p, why) => ({ root: mod12(r + dr), q, p, why, name: PC_NAMES[mod12(r + dr)] + qualityText(q, () => false) });
  switch (chord.q) {
    case 'm7':
      return [P(5, '7', 0.6, 'ii–V pull'), P(11, '7', 0.18, 'tritone sub'), P(1, 'm7', 0.1, 'side-slip up')];
    case 'm7b5':
      return [P(5, '7', 0.65, 'minor ii–V'), P(11, '7', 0.15, 'tritone sub')];
    case '7': case '7sus4':
      return [P(5, 'maj7', 0.55, 'V–I'), P(6, '7', 0.15, 'tritone sub'), P(2, 'm7', 0.12, 'deceptive (vi)')];
    case 'maj7': case '6': case 'maj':
      return [P(9, '7', 0.35, 'turnaround VI7'), P(2, 'm7', 0.3, 'back to ii'), P(5, 'm7', 0.15, 'backdoor iv')];
    default:
      return [P(5, '7', 0.5, 'down a fifth')];
  }
}

if (typeof module !== 'undefined') module.exports = { recognize, inferKey, predict, roman, PC_NAMES, mod12 };

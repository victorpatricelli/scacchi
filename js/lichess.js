// Lichess public API (read-only, CORS-enabled). Returns games as PGN strings with clocks.
const API = 'https://lichess.org/api/';

export async function profile(user) {
  const r = await fetch(API + 'user/' + encodeURIComponent(user));
  if (r.status === 404) throw new Error('Utente non trovato su Lichess');
  if (!r.ok) throw new Error('Lichess ha risposto ' + r.status);
  const p = await r.json(), perf = p.perfs || {};
  const rt = (k) => (perf[k] && perf[k].games ? perf[k].rating : null);
  return { username: p.username, ratings: { rapid: rt('rapid'), blitz: rt('blitz'), bullet: rt('bullet'), daily: rt('correspondence') } };
}

// since: timestamp in ms (only newer games), max: cap on games
export async function games(user, { since = 0, max = 300, onProgress } = {}) {
  const q = new URLSearchParams({ max: String(max), clocks: 'true', opening: 'true', evals: 'false', perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence' });
  if (since) q.set('since', String(since + 1));
  const r = await fetch(API + 'games/user/' + encodeURIComponent(user) + '?' + q, { headers: { Accept: 'application/x-chess-pgn' } });
  if (r.status === 404) throw new Error('Utente non trovato su Lichess');
  if (r.status === 429) throw new Error('Lichess chiede di aspettare un minuto');
  if (!r.ok) throw new Error('Lichess ha risposto ' + r.status);
  // stream so the counter moves while a long history downloads
  const reader = r.body && r.body.getReader ? r.body.getReader() : null;
  let text = '';
  if (reader) {
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (onProgress) onProgress((text.match(/\[Event /g) || []).length);
    }
  } else text = await r.text();
  return Core.splitPGN(text).filter((p) => /\[Variant "Standard"\]/.test(p) || !/\[Variant /.test(p));
}

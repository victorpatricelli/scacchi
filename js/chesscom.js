// Chess.com Published-Data API (read-only, public). Uses fetch (CORS); falls back to JSONP.
const API = 'https://api.chess.com/pub/player/';
let jsonpN = 0;

function jsonp(url) {
  return new Promise((res, rej) => {
    const name = '__ccjsonp' + (++jsonpN) + '_' + Date.now();
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); rej(new Error('Chess.com non risponde')); }, 20000);
    function cleanup() { clearTimeout(t); delete window[name]; s.remove(); }
    window[name] = (data) => { cleanup(); res(data); };
    s.onerror = () => { cleanup(); rej(new Error('Chess.com non raggiungibile')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + name;
    document.head.appendChild(s);
  });
}

async function get(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.status === 404) { const e = new Error('Utente non trovato su Chess.com'); e.code = 404; throw e; }
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); return get(url); }
    if (!r.ok) throw new Error('Chess.com ha risposto ' + r.status);
    return await r.json();
  } catch (e) {
    if (e.code === 404) throw e;
    return jsonp(url); // CORS or network trouble: try JSONP
  }
}

export async function profile(user) {
  const u = encodeURIComponent(user.toLowerCase());
  const [p, s] = await Promise.all([get(API + u), get(API + u + '/stats').catch(() => ({}))]);
  const r = (k) => (s[k] && s[k].last ? s[k].last.rating : null);
  return {
    username: p.username || user, name: p.name || '', avatar: p.avatar || '', country: (p.country || '').split('/').pop(),
    ratings: { rapid: r('chess_rapid'), blitz: r('chess_blitz'), bullet: r('chess_bullet'), daily: r('chess_daily') },
    puzzles: s.tactics && s.tactics.highest ? s.tactics.highest.rating : null
  };
}

export async function archives(user) {
  const d = await get(API + encodeURIComponent(user.toLowerCase()) + '/games/archives');
  return (d.archives || []).slice();
}

// Returns standard-chess games of one month: [{pgn, url, accuracies, end}]
export async function month(url) {
  const d = await get(url);
  return (d.games || []).filter((g) => (g.rules || 'chess') === 'chess' && g.pgn).map((g) => ({
    pgn: g.pgn, url: g.url, end: (g.end_time || 0) * 1000,
    accuracies: g.accuracies ? { w: g.accuracies.white, b: g.accuracies.black } : null
  }));
}

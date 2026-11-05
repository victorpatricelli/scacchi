# Scacchiera di Vik

App web per analizzare le partite di Chess.com con Stockfish 17.1, direttamente nel browser del telefono.

- **Caricamento diretto** dall'archivio pubblico di Chess.com e, se vuoi, da Lichess (API pubbliche, nessuna password)
- **Motore live** (⚡): Stockfish valuta in tempo reale ogni posizione mentre scorri la partita, con le 3 linee migliori e un giudizio provvisorio anche sulle partite non ancora analizzate
- **La tua storia**: a quale campione somigli, Punteggio Vik e l'errore che ti costa di più
- **Revisione mossa per mossa** con classificazioni (brillante, ottima, migliore, teoria, imprecisione, errore, occasione mancata, blunder), barra di valutazione, frecce e modalità esplora con il motore
- **Statistiche**: precisione pezzo per pezzo, per fase, tattiche mancate/concesse/sfruttate, gestione del tempo, aperture
- **Puzzle** generati dai propri errori e dalle mosse brillanti mancate, filtrabili per tattica (matto, forchetta, inchiodatura, infilata, sacrificio, deviazione…), dalle partite più vecchie o più recenti; quelli risolti non tornano più
- **Riprova** (come su Chess.com): rigioca da solo la mossa giusta dopo un errore, il motore risponde
- **Mosse brillanti mancate**: quando c'era un sacrificio vincente compare la linea da studiare passo passo
- **Livello stimato** di ogni partita (stile «Game Rating»), precisione per fase, momenti chiave, minaccia dell'avversario
- Si può muovere direttamente sulla scacchiera durante la revisione: si apre una variante
- Statistiche solo dalle partite da 3 minuti in su (modificabile nelle impostazioni)
- Installabile come app (PWA), funziona offline, si può condividere una partita dall'app di Chess.com

Tutto resta sul dispositivo (IndexedDB). Backup esportabile dalle impostazioni.

## Crediti

- [Stockfish](https://stockfishchess.org) 17.1, build JavaScript/WebAssembly [stockfish.js](https://github.com/nmrugg/stockfish.js) — GPLv3 (vedi `engine/COPYING.txt`)
- [chess.js](https://github.com/jhlywa/chess.js) 0.10.3 — BSD-2
- Pezzi «cburnett» di Colin M.L. Burnett, dal repository di [lichess](https://github.com/lichess-org/lila) — CC BY-SA 3.0
- Nomi delle aperture da [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) — CC0

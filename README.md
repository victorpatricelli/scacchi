# Scacchiera di Vik

App web per analizzare le partite di Chess.com con Stockfish 17.1, direttamente nel browser del telefono.

- **Caricamento diretto** dall'archivio pubblico di Chess.com (API pubblica, nessuna password)
- **Revisione mossa per mossa** con classificazioni (brillante, ottima, migliore, teoria, imprecisione, errore, occasione mancata, blunder), barra di valutazione, frecce e modalità esplora con il motore
- **Statistiche**: precisione pezzo per pezzo, per fase, tattiche mancate/concesse/sfruttate, gestione del tempo, aperture
- **Puzzle** generati dai propri errori
- Installabile come app (PWA), funziona offline, si può condividere una partita dall'app di Chess.com

Tutto resta sul dispositivo (IndexedDB). Backup esportabile dalle impostazioni.

## Crediti

- [Stockfish](https://stockfishchess.org) 17.1, build JavaScript/WebAssembly [stockfish.js](https://github.com/nmrugg/stockfish.js) — GPLv3 (vedi `engine/COPYING.txt`)
- [chess.js](https://github.com/jhlywa/chess.js) 0.10.3 — BSD-2
- Pezzi «cburnett» di Colin M.L. Burnett, dal repository di [lichess](https://github.com/lichess-org/lila) — CC BY-SA 3.0
- Nomi delle aperture da [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) — CC0

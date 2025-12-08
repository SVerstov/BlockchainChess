You should have .env file with the following variables set:
PRIVATE_KEY=<your_private_key>

# API: `/validate_move`

Validate a chess move given a FEN and a UCI move. Request and response use JSON.

## Request

POST `/validate_move`
Content-Type: `application/json`

Example body:

```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "uci_move": "e2e4"
}
```

# Successful response (legal move, game continues)

```json
{
  "new_fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "game_over": false,
  "result": null,
  "signature": "0x<hexadecimal_signature_here>"
}
```

# Successful response (legal move, game over)

possible results:
0 - ongoing game
1 - 1-0 (white wins)
2 - 0-1 (black wins)
3 - ½-½ (draw)

```json
{
  "new_fen": "8/8/8/8/8/8/7k/7K w - - 0 1",
  "game_over": true,
  "result": "1-0",
  "signature": "0x<hexadecimal_signature_here>"
}
```

# Validation error response (illegal move)

HTTP Status: 422

# Run front

`npm install vite@5.4.11 --save-dev`
`cd front`
`npm install ethers axios chess.js react-chessboard`
`npm run dev`
import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import axios from "axios";


const CONTRACT_ADDRESS = "0xd50C54B3E1B4F382c29534ec1b668079ebcC1F64";
const ORACLE_URL = "http://localhost:8000"; // URL FastAPI

// ABI (Human readable format for Ethers v5/v6)
const ABI = [
  "function newGame() public payable returns (uint256)",
  "function joinGame(uint256 _gameId) public payable",
  "function move(uint256 _gameId, string memory _newFen, uint8 _result, bytes memory _signature) public",
  "function games(uint256) view returns (uint256 gameId, address playerWhite, address playerBlack, string fen, uint256 lastMoveTimestamp, uint256 betAmount, bool isActive, bool isWhiteTurn)",
  "function callTimeout(uint256 _gameId) public",
  "event MoveMade(uint256 indexed gameId, address player, string newFen)",
  "event GameEnded(uint256 indexed gameId, address winner, string reason)"
];

function App() {
  const [game, setGame] = useState(new Chess());
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState("");

  // Состояние игры
  const [gameId, setGameId] = useState("");
  const [betAmount, setBetAmount] = useState("0.001");
  const [gameState, setGameState] = useState(null); // Данные из блокчейна
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  // 1. Подключение кошелька
  const connectWallet = async () => {
    if (window.ethereum) {
      const _provider = new ethers.BrowserProvider(window.ethereum);
      const _signer = await _provider.getSigner();
      const _contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, _signer);

      setProvider(_provider);
      setSigner(_signer);
      setContract(_contract);
      // Нормализуем адрес для корректного сравнения
      const addr = await _signer.getAddress();
      setAccount(addr.toLowerCase());
      console.log("Wallet connected:", addr);
    } else {
      alert("Install Metamask!");
    }
  };

  // Автозагрузка gameId из URL при монтировании
  useEffect(() => {
    const url = new URL(window.location);
    const fromUrl = url.searchParams.get("gameId");
    if (fromUrl) {
      setGameId(fromUrl);
      console.log("Loaded gameId from URL:", fromUrl);
    }
  }, []);

  // 2. Создание игры
  const createGame = async () => {
    if (!contract) return;
    try {
      setLoading(true);
      const tx = await contract.newGame({ value: ethers.parseEther(betAmount) });
      setStatus("Creating game... Waiting for tx");
      await tx.wait();
      setStatus("Game created! Check logs for ID (or wait for UI update)");
      // В реальности лучше слушать событие GameCreated, но пока просто скажем пользователю
    } catch (e) {
      console.error(e);
      alert("Error creating game");
    } finally {
      setLoading(false);
    }
  };

  // 3. Присоединение к игре
  const joinGame = async () => {
    if (!contract || !gameId) return;
    try {
      setLoading(true);
      const g = await contract.games(gameId);
      const tx = await contract.joinGame(gameId, { value: g.betAmount });
      setStatus("Joining game...");
      await tx.wait();
      setStatus("Joined!");

      // Сохраняем ID в адресную строку браузера без перезагрузки
      const url = new URL(window.location);
      url.searchParams.set("gameId", gameId);
      window.history.pushState({}, "", url);

      fetchGameState();
    } catch (e) {
      console.error(e);
      alert("Error joining game");
    } finally {
      setLoading(false);
    }
  };

  // 4. Получение состояния игры из блокчейна
  const fetchGameState = useCallback(async () => {
    if (!contract || !gameId) return;
    try {
      const g = await contract.games(gameId);
      // Структура g: [id, white, black, fen, time, bet, active, turn]

      const currentFen = g.fen;
      const isWhiteTurn = g.isWhiteTurn;

      // Синхронизируем локальную шахматную логику с блокчейном
      const safeFen = currentFen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
      if (game.fen() !== safeFen) {
        const newGame = new Chess(safeFen);
        setGame(newGame);
      }

      setGameState({
        playerWhite: g.playerWhite?.toLowerCase?.() ? g.playerWhite.toLowerCase() : g.playerWhite,
        playerBlack: g.playerBlack?.toLowerCase?.() ? g.playerBlack.toLowerCase() : g.playerBlack,
        isActive: g.isActive,
        isWhiteTurn: isWhiteTurn,
        lastMoveTime: Number(g.lastMoveTimestamp)
      });
//       console.log("Game state updated:", {
//         playerWhite: g.playerWhite,
//         playerBlack: g.playerBlack,
//         isActive: g.isActive,
//         isWhiteTurn,
//         fen: safeFen,
//       });
    } catch (e) {
      console.error("Error fetching game:", e);
    }
  }, [contract, gameId, game]);

  // Полллинг (обновление) состояния каждые 5 секунд
  useEffect(() => {
    const interval = setInterval(() => {
        if (gameId) fetchGameState();
    }, 5000);
    return () => clearInterval(interval);
  }, [gameId, fetchGameState]);


  // 5. Логика хода (The Core Logic)
  const onDrop = async (sourceSquare, targetSquare, piece) => {
    console.log("onDrop invoked:", { sourceSquare, targetSquare, piece });
    if (!gameState || !gameState.isActive) {
      console.warn("Drop ignored: game not active or no state yet");
      return false;
    }

    // Проверка очередности хода (локально, для UI)
    const isMyTurn = (gameState.isWhiteTurn && account === gameState.playerWhite) ||
                     (!gameState.isWhiteTurn && account === gameState.playerBlack);

    if (!isMyTurn) {
      alert("Not your turn!");
      return false;
    }

    // Попытка сделать ход локально (chess.js)
    // Важно: создаем копию инстанса, чтобы проверить валидность
    const gameCopy = new Chess(game.fen());
    let move = null;
    try {
        move = gameCopy.move({
            from: sourceSquare,
            to: targetSquare,
            promotion: "q", // всегда превращаем в ферзя для простоты
        });
    } catch (e) {
        console.warn("Illegal move attempted", e);
        return false; // Невалидный ход
    }

    if (!move) return false;

    // Если ход валиден локально, отправляем Оракулу
    try {
        setLoading(true);
        setStatus("Validating with Oracle...");

        // Формируем UCI ход (например, "e2e4")
        const uciMove = move.from + move.to + (move.promotion || "");

        // A. Запрос к Python Oracle
        const response = await axios.post(`${ORACLE_URL}/validate_move`, {
            game_id: Number(gameId),
            fen: game.fen(), // Текущий FEN (до хода)
            uci_move: uciMove
        });

        const { new_fen, result, signature } = response.data;

        // B. Отправка транзакции в Solidity
        setStatus("Oracle signed. Sending to Blockchain...");
        const tx = await contract.move(gameId, new_fen, result, signature);

        await tx.wait();
        setStatus("Move confirmed on-chain!");

        // Обновляем доску сразу
        setGame(new Chess(new_fen));
        fetchGameState(); // Получаем свежие данные
        return true;

    } catch (e) {
        console.error("Move failed:", e);
        alert("Move failed: " + (e.response?.data?.detail || e.message));
        return false;
    } finally {
        setLoading(false);
    }
  };

  const claimTimeout = async () => {
      if(!contract || !gameId) return;
      try {
          setLoading(true);
          const tx = await contract.callTimeout(gameId);
          await tx.wait();
          alert("Timeout claimed!");
          fetchGameState();
      } catch(e) {
          console.error(e);
          alert("Error claiming timeout");
      } finally {
          setLoading(false);
      }
  }

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: "0 auto", fontFamily: "sans-serif" }}>
      <h1>On-Chain Chess ♟️</h1>

      {!account ? (
        <button onClick={connectWallet} style={{padding: 10, fontSize: 16}}>Connect Wallet</button>
      ) : (
        <p>Connected: {account.slice(0,6)}...{account.slice(-4)}</p>
      )}

      <hr />

      <div style={{ marginBottom: 20 }}>
        <h3>Lobby</h3>
        <input
            placeholder="Bet Amount (ETH)"
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
        />
        <button onClick={createGame} disabled={loading} style={{marginLeft: 10}}>
            Create New Game
        </button>
        <br /><br />
        <input
            placeholder="Game ID"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
        />
        <button onClick={joinGame} disabled={loading} style={{marginLeft: 10}}>
            Join Game
        </button>
        <button onClick={fetchGameState} style={{marginLeft: 10}}>
            Refresh
        </button>
      </div>

      {status && <div style={{background: "#f0f0f0", padding: 10, marginBottom: 10}}>{status}</div>}

      <div style={{ height: 400, width: 400 }}>
        <Chessboard
            position={game.fen()}
            onPieceDrop={onDrop}
            onPieceDragBegin={(piece, square) => {
              console.log("drag begin", { piece, square });
            }}
            boardWidth={400}
            // Разрешаем перетаскивание до получения состояния, чтобы увидеть, что onDrop вызывается
            arePiecesDraggable={!loading && (gameState ? gameState.isActive : true)}
        />
      </div>

      {gameState && (
        <div style={{ marginTop: 20 }}>
            <p><strong>Status:</strong> {gameState.isActive ? "Active" : "Finished"}</p>
            <p><strong>Turn:</strong> {gameState.isWhiteTurn ? "White" : "Black"}</p>
            <p><strong>White:</strong> {gameState.playerWhite}</p>
            <p><strong>Black:</strong> {gameState.playerBlack}</p>
            <button onClick={claimTimeout} disabled={!gameState.isActive}>Call Timeout</button>
        </div>
      )}
    </div>
  );
}

export default App;
import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import axios from "axios";

const CONTRACT_ADDRESS = "0xd50C54B3E1B4F382c29534ec1b668079ebcC1F64";
const ORACLE_URL = "http://localhost:8000";

const ABI = [
  "function newGame() public payable returns (uint256)",
  "function joinGame(uint256 _gameId) public payable",
  "function move(uint256 _gameId, string memory _newFen, uint8 _result, bytes memory _signature) public",
  "function games(uint256) view returns (uint256 gameId, address playerWhite, address playerBlack, string fen, uint256 lastMoveTimestamp, uint256 betAmount, bool isActive, bool isWhiteTurn)",
  "function callTimeout(uint256 _gameId) public",
  "event MoveMade(uint256 indexed gameId, address player, string newFen)",
  "event GameEnded(uint256 indexed gameId, address winner, string reason)"
];

const normalizeAddr = (addr) => (addr ? addr.toLowerCase() : "");

function App() {
  const [game, setGame] = useState(new Chess());
  const [chessPosition, setChessPosition] = useState(() => new Chess().fen());
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState("");

  const [boardOrientation, setBoardOrientation] = useState("white");

  // Game state
  const [gameId, setGameId] = useState("");
  const [betAmount, setBetAmount] = useState("0.001");
  const [gameState, setGameState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [uciInput, setUciInput] = useState("");

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const _provider = new ethers.BrowserProvider(window.ethereum);
        const _signer = await _provider.getSigner();
        const _contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, _signer);

        setProvider(_provider);
        setSigner(_signer);
        setContract(_contract);

        const addr = await _signer.getAddress();
        const normAddr = normalizeAddr(addr);
        setAccount(normAddr);
        console.log("Wallet connected:", normAddr);
      } catch (err) {
        console.error("User rejected connection", err);
      }
    } else {
      alert("Install Metamask!");
    }
  };

  useEffect(() => {
    const checkConnection = async () => {
        if (window.ethereum) {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                connectWallet();
            }
        }
    };
    checkConnection();
  }, []);

  // autoload gameId from url
  useEffect(() => {
    const url = new URL(window.location);
    const fromUrl = url.searchParams.get("gameId");
    if (fromUrl) {
      setGameId(fromUrl);
    }
  }, []);

  // sync logic and chess board orientation
  const fetchGameState = useCallback(async () => {
    if (!contract || !gameId) return;
    try {
      const g = await contract.games(gameId);

      const safeFen = g.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
      const pWhite = normalizeAddr(g.playerWhite);
      const pBlack = normalizeAddr(g.playerBlack);

      // sync chess board
      if (game.fen() !== safeFen) {
        const newGame = new Chess(safeFen);
        setGame(newGame);
        setChessPosition(safeFen);
      }

      setGameState({
        playerWhite: pWhite,
        playerBlack: pBlack,
        isActive: g.isActive,
        isWhiteTurn: g.isWhiteTurn,
        lastMoveTime: Number(g.lastMoveTimestamp)
      });

      // board orientation
      if (account && pBlack && account === pBlack) {
         setBoardOrientation("black");
      } else {
         setBoardOrientation("white");
      }

    } catch (e) {
      console.error("Error fetching game:", e);
    }
  }, [contract, gameId, game, account]); // Убрал лишние зависимости

  // updating
  useEffect(() => {
    const interval = setInterval(() => {
        if (gameId && contract) fetchGameState();
    }, 5000);
    return () => clearInterval(interval);
  }, [gameId, contract, fetchGameState]);


  //  GAME ACTIONS

  const createGame = async () => {
    if (!contract) return;
    try {
      setLoading(true);
      const tx = await contract.newGame({ value: ethers.parseEther(betAmount) });
      setStatus("Creating game... Waiting for tx");
      await tx.wait();
      setStatus("Game created! Check logs or refresh.");
    } catch (e) {
      console.error(e);
      alert("Error creating game");
    } finally {
      setLoading(false);
    }
  };

  const joinGame = async () => {
    if (!contract || !gameId) return;
    try {
      setLoading(true);
      const g = await contract.games(gameId);
      const tx = await contract.joinGame(gameId, { value: g.betAmount });
      setStatus("Joining game...");
      await tx.wait();
      setStatus("Joined!");

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

  const executeOracleMove = async (uciMove, currentFen) => {
      try {
        setLoading(true);
        setStatus("Validating with Oracle...");

        const response = await axios.post(`${ORACLE_URL}/validate_move`, {
            game_id: Number(gameId),
            fen: currentFen,
            uci_move: uciMove
        });
        const { new_fen, result, signature } = response.data;

        setStatus("Oracle signed. Sending to Blockchain...");
        const tx = await contract.move(gameId, new_fen, result, signature);
        await tx.wait();
        setStatus("Move confirmed on-chain!");

        const updated = new Chess(new_fen);
        setGame(updated);
        setChessPosition(new_fen);

        
        setTimeout(fetchGameState, 1000);
        return true;
      } catch (e) {
        console.error("Move failed:", e);
        alert("Move failed: " + (e.response?.data?.detail || e.message));
        return false;
      } finally {
        setLoading(false);
      }
  }

  const onDrop = async (sourceSquare, targetSquare) => {
    if (!gameState || !gameState.isActive) return false;

    // check moove order
    const isMyTurn = (gameState.isWhiteTurn && account === gameState.playerWhite) ||
                     (!gameState.isWhiteTurn && account === gameState.playerBlack);

    if (!isMyTurn) {
        console.log("Not your turn");
        return false;
    }

    const gameCopy = new Chess(chessPosition);
    let move = null;
    try {
      move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
    } catch (e) { return false; }

    if (!move) return false;

    const uciMove = move.from + move.to + (move.promotion || "");
    return await executeOracleMove(uciMove, chessPosition);
  };

  const submitUciMove = async () => {
    const uci = uciInput.trim().toLowerCase();
    if (!uci || !gameState || !gameState.isActive) return;

    // Валидация хода движком
    const gameCopy = new Chess(game.fen());
    try {
        const from = uci.slice(0,2);
        const to = uci.slice(2,4);
        const promo = uci.length === 5 ? uci.slice(4,5) : undefined;
        const move = gameCopy.move({ from, to, promotion: promo || 'q' });
        if(!move) throw new Error();
    } catch(e) {
        alert("Illegal move");
        return;
    }

    const success = await executeOracleMove(uci, game.fen());
    if (success) setUciInput("");
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

  const canMovePieces = !loading &&
                        gameState &&
                        gameState.isActive &&
                        ((gameState.isWhiteTurn && account === gameState.playerWhite) ||
                         (!gameState.isWhiteTurn && account === gameState.playerBlack));

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
            style={{ width: "100px", marginRight: "10px" }}
        />
        <button onClick={createGame} disabled={loading}>Create New Game</button>
        <br /><br />
        <input
            placeholder="Game ID"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
            style={{ width: "100px", marginRight: "10px" }}
        />
        <button onClick={joinGame} disabled={loading} style={{ marginRight: "10px" }}>Join Game</button>
        <button onClick={fetchGameState}>Refresh</button>
      </div>

      {status && <div style={{background: "#333", color: "#fff", padding: 10, marginBottom: 10, borderRadius: 4}}>{status}</div>}

      <div style={{ height: 400, width: 400, margin: "0 auto" }}>
        <Chessboard
            id="BasicBoard"
            position={chessPosition}
            onPieceDrop={onDrop}
            boardWidth={400}
            boardOrientation={boardOrientation}
            arePiecesDraggable={canMovePieces}
        />
      </div>

      <div style={{ marginTop: 12, textAlign: "center" }}>
        <input
            value={uciInput}
            onChange={(e) => setUciInput(e.target.value)}
            placeholder="UCI (e.g. e2e4)"
            style={{ marginRight: 8, padding: 5 }}
        />
        <button onClick={submitUciMove} disabled={!canMovePieces}>
          Make Move
        </button>
      </div>

      {gameState && (
        <div style={{ marginTop: 20, padding: 10, border: "1px solid #ccc", borderRadius: 8 }}>
            <p><strong>Status:</strong> {gameState.isActive ? "🟢 Active" : "🔴 Finished"}</p>
            <p><strong>Turn:</strong> {gameState.isWhiteTurn ? "White" : "Black"}</p>
            <div style={{ fontSize: "0.9em", color: "#666" }}>
                <p>White: {gameState.playerWhite}</p>
                <p>Black: {gameState.playerBlack}</p>
            </div>
            <button onClick={claimTimeout} disabled={!gameState.isActive} style={{marginTop: 10, cursor: "pointer"}}>
                Call Timeout
            </button>
        </div>
      )}
    </div>
  );
}

export default App;
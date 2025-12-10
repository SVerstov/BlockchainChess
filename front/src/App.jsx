import React, {useState, useEffect, useCallback} from "react";
import {ethers} from "ethers";
import {Chess} from "chess.js";
import {Chessboard} from "react-chessboard";
import axios from "axios";

// Load settings from environment (.env) via Vite
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const ORACLE_URL = import.meta.env.VITE_ORACLE_URL;

if (!CONTRACT_ADDRESS) {
    console.warn("VITE_CONTRACT_ADDRESS is not set. Please define it in your .env file.");
}
if (!ORACLE_URL) {
    console.warn("VITE_ORACLE_URL is not set. Please define it in your .env file.");
}

const ABI = [
    "function newGame() public payable returns (uint256)",
    "function joinGame(uint256 _gameId) public payable",
    "function move(uint256 _gameId, string memory _newFen, uint8 _result, bytes memory _signature) public",
    "function games(uint256) view returns (uint256 gameId, address playerWhite, address playerBlack, string fen, uint256 lastMoveTimestamp, uint256 betAmount, bool isWhiteTurn, bool isDrawOffered, uint8 status)",
    "function moveTimeout() view returns (uint256)",
    "function callTimeout(uint256 _gameId) public",
    "function resign(uint256 _gameId) public",
    "function cancelGame(uint256 _gameId) public",
    "function offerDraw(uint256 _gameId) public",
    "function acceptDraw(uint256 _gameId) public",
    "event MoveMade(uint256 indexed gameId, address player, string newFen)",
    "event GameEnded(uint256 indexed gameId, address winner, string reason)",
    "event GameCreated(uint256 indexed gameId, address whitePlayer, uint256 betAmount)",
    "event GameStarted(uint256 indexed gameId, address whitePlayer, address blackPlayer)",
    "event OfferedDraw(uint256 indexed gameId, address player)"
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
    const [moveTimeoutSec, setMoveTimeoutSec] = useState(null);
    const [remainingSeconds, setRemainingSeconds] = useState(null);
    const [copyMsg, setCopyMsg] = useState("");
    const [pendingMove, setPendingMove] = useState(false);

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
                const accounts = await window.ethereum.request({method: 'eth_accounts'});
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

    const statusText = (s) => {
        switch (Number(s)) {
            case 0:
                return "🟢 In Progress";
            case 1:
                return "🏁 White Won";
            case 2:
                return "🏁 Black Won";
            case 3:
                return "🤝 Draw";
            case 4:
                return "❌ Cancelled";
            case 5:
                return "⏳ Waiting for Opponent...";
            default:
                return "Unknown";
        }
    };

    // sync logic and chess board orientation
    const fetchGameState = useCallback(async () => {
        if (!contract || !gameId) return;
        try {
            const g = await contract.games(gameId);
            // fetch global move timeout once
            if (moveTimeoutSec == null) {
                try {
                    const mt = await contract.moveTimeout();
                    setMoveTimeoutSec(Number(mt));
                } catch (e) {
                    console.warn("Unable to fetch moveTimeout", e);
                }
            }
            const safeFen = g.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
            const pWhite = normalizeAddr(g.playerWhite);
            const pBlack = normalizeAddr(g.playerBlack);

            // sync chess board
            if (game.fen() !== safeFen) {
                const newGame = new Chess(safeFen);
                setGame(newGame);
                setChessPosition(safeFen);
            }

            const currentStatus = Number(g.status);
            const isActive = currentStatus === 0; // InProgress
            const lastTs = Number(g.lastMoveTimestamp);
            const nextState = {
                playerWhite: pWhite,
                playerBlack: pBlack,
                status: currentStatus,
                isActive,
                isWhiteTurn: g.isWhiteTurn,
                isDrawOffered: Boolean(g.isDrawOffered),
                lastMoveTime: lastTs,
                betAmount: g.betAmount
            };
            setGameState(nextState);

            // compute initial remaining
            if (moveTimeoutSec != null && lastTs > 0) {
                const now = Math.floor(Date.now() / 1000);
                const rem = Math.max(0, lastTs + moveTimeoutSec - now);
                setRemainingSeconds(rem);
            }

            // board orientation
            if (account && pBlack && account === pBlack) {
                setBoardOrientation("black");
            } else {
                setBoardOrientation("white");
            }

            // update status banner using Your Turn / Opponent's Turn, but do not override when a move is pending
            const amWhiteLocal = account && account === pWhite;
            const amBlackLocal = account && account === pBlack;
            const isMyTurnLocal = (g.isWhiteTurn && amWhiteLocal) || (!g.isWhiteTurn && amBlackLocal);
            if (amBlackLocal || amWhiteLocal) {
                if (!pendingMove) {
                    if (isActive && isMyTurnLocal) {
                        setStatus("Your Turn!");
                    } else if (isActive) {
                        setStatus("Opponent's Turn");
                    } else {
                        // finished states will be reflected by statusText elsewhere; clear manual banner
                        if (status === "Your Turn!" || status === "Opponent's Turn") setStatus("");
                    }
                }
            } else {
                setStatus("Your are not a player. Spectating mode");
                }

        } catch (e) {
            console.error("Error fetching game:", e);
        }
    }, [contract, gameId, account, moveTimeoutSec, pendingMove, status]);

    // Update game polling and countdown timer
    useEffect(() => {
        const pollId = setInterval(() => {
            if (gameId && contract) fetchGameState();
        }, 2000);
        return () => clearInterval(pollId);
    }, [gameId, contract, fetchGameState]);

    useEffect(() => {
        const tick = () => {
            if (moveTimeoutSec == null || !gameState) return;
            const now = Math.floor(Date.now() / 1000);
            const rem = Math.max(0, gameState.lastMoveTime + moveTimeoutSec - now);
            setRemainingSeconds(rem);
        };
        const timerId = setInterval(tick, 1000);
        tick();
        return () => clearInterval(timerId);
    }, [moveTimeoutSec, gameState]);

    const formatDuration = (seconds) => {
        if (seconds == null) return "";
        const s = Math.max(0, Math.floor(seconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return `${h}h ${m}m ${sec}s`;
        return `${m}m ${sec}s`;
    };

    const formatEth = (wei) => {
        if (wei == null) return "";
        try {
            return `${ethers.formatEther(wei)} ETH`;
        } catch {
            // allow Number or bigint
            return `${wei} wei`;
        }
    };

    //  GAME ACTIONS

    const extractGameIdFromReceipt = async (receipt) => {
        // 1) Try direct log parse from receipt
        try {
            for (const log of receipt.logs) {
                try {
                    const parsed = contract.interface.parseLog(log);
                    if (parsed?.name === "GameCreated") {
                        return parsed.args.gameId?.toString();
                    }
                } catch (_) {
                }
            }
        } catch (_) {
        }

        // 2) Fallback: query the chain for GameCreated in the same block range
        try {
            const fromBlock = receipt.blockNumber;
            const toBlock = receipt.blockNumber;
            const filter = contract.filters.GameCreated?.();
            const events = await contract.queryFilter(filter, fromBlock, toBlock);
            if (events && events.length > 0) {
                // If multiple events in the block, try to pick the one by tx hash
                const matched = events.find(ev => ev.transactionHash === receipt.hash) || events[0];
                const gid = matched?.args?.gameId;
                if (gid != null) return gid.toString();
            }
        } catch (e) {
            console.warn("Fallback queryFilter failed:", e);
        }

        // 3) Last resort: retry querying for a short time (indexers may lag)
        for (let i = 0; i < 5; i++) { // ~5 retries
            try {
                await new Promise(r => setTimeout(r, 1500));
                const filter = contract.filters.GameCreated?.();
                const events = await contract.queryFilter(filter, receipt.blockNumber - 2, receipt.blockNumber + 2);
                const matched = events.find(ev => ev.transactionHash === receipt.hash);
                if (matched) {
                    const gid = matched.args?.gameId;
                    if (gid != null) return gid.toString();
                }
            } catch (_) {
            }
        }
        return null;
    };

    const createGame = async () => {
        if (!contract) return;
        try {
            setLoading(true);
            const tx = await contract.newGame({value: ethers.parseEther(betAmount)});
            setStatus("Creating game... Waiting for tx");
            const receipt = await tx.wait();

            // Robustly get gameId
            setStatus("Parsing GameCreated event...");
            let newGameId = await extractGameIdFromReceipt(receipt);

            if (!newGameId) {
                setStatus("Still waiting for GameCreated... trying again");
                // Short extra wait to allow event indexing
                newGameId = await extractGameIdFromReceipt(receipt);
            }

            if (!newGameId) {
                setStatus("Game created, but unable to parse event yet. Enter the ID or check explorer.");
            } else {
                setGameId(newGameId);
                setStatus(`Game created! ID: ${newGameId}`);
                const url = new URL(window.location);
                url.searchParams.set("gameId", newGameId);
                window.history.pushState({}, "", url);
                await fetchGameState();
            }
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
            const tx = await contract.joinGame(gameId, {value: g.betAmount});
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
            const {new_fen, result, signature} = response.data;

            // Send tx and show pending status
            setStatus(`Please confirm move ${uciMove}...`);
            setPendingMove(true);
            const tx = await contract.move(gameId, new_fen, result, signature);
            setStatus("Move sent to blockchain. Waiting...");
            await tx.wait();

            setPendingMove(false);
            setStatus("Move confirmed on-chain!");

            const updated = new Chess(new_fen);
            setGame(updated);
            setChessPosition(new_fen);

            setTimeout(fetchGameState, 1000);
            return true;
        } catch (e) {
            console.error("Move failed:", e);
            setPendingMove(false);
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
            move = gameCopy.move({from: sourceSquare, to: targetSquare, promotion: "q"});
        } catch (e) {
            return false;
        }

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
            const from = uci.slice(0, 2);
            const to = uci.slice(2, 4);
            const promo = uci.length === 5 ? uci.slice(4, 5) : undefined;
            const move = gameCopy.move({from, to, promotion: promo || 'q'});
            if (!move) throw new Error();
        } catch (e) {
            alert("Illegal move");
            return;
        }

        const success = await executeOracleMove(uci, game.fen());
        if (success) setUciInput("");
    };

    const claimTimeout = async () => {
        if (!contract || !gameId) return;
        try {
            setLoading(true);
            const tx = await contract.callTimeout(gameId);
            await tx.wait();
            alert("Timeout claimed!");
            fetchGameState();
        } catch (e) {
            console.error(e);
            alert("Error claiming timeout");
        } finally {
            setLoading(false);
        }
    }

    const resign = async () => {
        if (!contract || !gameId) return;
        try {
            setStatus("Are you sure you want to resign?");
            setLoading(true);
            const tx = await contract.resign(gameId);
            await tx.wait();
            alert("You resigned");
            fetchGameState();
        } catch (e) {
            console.error(e);
            alert("Error resigning");
        } finally {
            setLoading(false);
        }
    }

    const cancel = async () => {
        if (!contract || !gameId) return;
        try {
            setLoading(true);
            setStatus("Are you sure you want to cancel a game?");
            const tx = await contract.cancelGame(gameId);
            await tx.wait();
            alert("Game cancelled");
            fetchGameState();
        } catch (e) {
            console.error(e);
            alert("Error cancelling");
        } finally {
            setLoading(false);
        }
    }

    const offerDraw = async () => {
        setStatus("Are you sure you want offer a draw?");
        if (!contract || !gameId) return;
        try {
            setLoading(true);
            const tx = await contract.offerDraw(gameId);
            await tx.wait();
            alert("Draw offered");
            fetchGameState();
        } catch (e) {
            console.error(e);
            alert("Error offering draw");
        } finally {
            setLoading(false);
        }
    }

    const acceptDraw = async () => {
        setStatus("Are you sure you want accept a draw?");
        if (!contract || !gameId) return;
        try {
            setLoading(true);
            const tx = await contract.acceptDraw(gameId);
            await tx.wait();
            alert("Draw accepted");
            fetchGameState();
        } catch (e) {
            console.error(e);
            alert("Error accepting draw");
        } finally {
            setLoading(false);
        }
    }

    const copyText = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopyMsg("Copied!");
            setTimeout(() => setCopyMsg(""), 1500);
        } catch (e) {
            console.warn("Clipboard failed", e);
            setCopyMsg("Copy failed");
            setTimeout(() => setCopyMsg(""), 1500);
        }
    };

    const shareUrl = () => {
        const url = new URL(window.location);
        if (gameId) url.searchParams.set("gameId", gameId);
        return url.toString();
    };

    const canMovePieces = !loading &&
        gameState &&
        gameState.isActive &&
        ((gameState.isWhiteTurn && account === gameState.playerWhite) ||
            (!gameState.isWhiteTurn && account === gameState.playerBlack));

    // Availability rules
    const isWaitingForOpponent = gameState?.status === 5; // WaitingForOpponent
    const isInProgress = gameState?.status === 0;
    const isPlayer = account && gameState && (account === gameState.playerWhite || account === gameState.playerBlack);
    const amWhite = gameState && account === gameState.playerWhite;
    const amBlack = gameState && account === gameState.playerBlack;
    const isMyTurn = gameState && ((gameState.isWhiteTurn && amWhite) || (!gameState.isWhiteTurn && amBlack));
    const canResign = isInProgress && isPlayer;
    const canCancel = isWaitingForOpponent && amWhite; // only white can cancel before start
    const canOfferDraw = isInProgress && !isMyTurn && isPlayer && !gameState.isDrawOffered;
    const canAcceptDraw = isInProgress && gameState?.isDrawOffered && isMyTurn;

    return (
        <div style={{
            padding: 20,
            maxWidth: 1300,
            margin: "0 auto",
            fontFamily: "sans-serif"
        }}>
            <h1 style={{textAlign: "center"}}>On-Chain Chess ♟️</h1>

            {!account ? (
                <div style={{display: "flex", justifyContent: "center", marginBottom: 10}}>
                    <button onClick={connectWallet} style={{padding: 10, fontSize: 16}}>Connect Wallet</button>
                </div>
            ) : (
                <p style={{textAlign: "center"}}>Connected: {account.slice(0, 6)}...{account.slice(-4)}</p>
            )}

            <hr/>

            <div style={{marginBottom: 20, textAlign: "center"}}>
                <input
                    placeholder="Bet Amount (ETH)"
                    // value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    style={{width: "120px", marginRight: "10px"}}
                />
                <button onClick={createGame} disabled={loading}>Create New Game</button>
                <br/><br/>
                <input
                    placeholder="Game ID"
                    value={gameId}
                    onChange={(e) => setGameId(e.target.value)}
                    style={{width: "70px", marginRight: "10px"}}
                />
                <button onClick={fetchGameState} style={{marginRight: "10px"}}>Load</button>
                <button onClick={joinGame} disabled={!gameId || !isWaitingForOpponent || amWhite}
                        style={{marginRight: "10px"}}>Join
                </button>
                <button onClick={() => copyText(shareUrl())} disabled={!gameId} style={{marginLeft: "10px"}}>Copy Link to
                    Game
                </button>
                {copyMsg && <span style={{marginLeft: 8, color: "#2c7"}}>{copyMsg}</span>}
            </div>

            {status && (
                <div style={{
                    background: "#333",
                    color: "#fff",
                    padding: 10,
                    marginBottom: 10,
                    borderRadius: 4,
                    textAlign: "center"
                }}>
                    {status}
                    {gameId && status.startsWith("Game created!") && (
                        <div style={{marginTop: 8}}>
                            <a href={shareUrl()} target="_blank" rel="noreferrer">Open game link</a>
                            <button onClick={() => copyText(shareUrl())} style={{marginLeft: 10}}>Copy Link</button>
                        </div>
                    )}
                </div>
            )}

            <div style={{display: "flex", gap: 24, alignItems: "flex-start", justifyContent: "center"}}>
                {/* Left column: status + actions */}
                {gameState && (
                    <div style={{
                        padding: 12,
                        border: "1px solid #ccc",
                        borderRadius: 8,
                        width: 300,
                        // height: 550,
                        maxHeight: 800,
                        textAlign: "left",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-start",
                        alignItems: "center"
                    }}>
                        <div style={{width: "100%"}}>
                            <p><strong>Status:</strong> {statusText(gameState.status)}</p>
                            <p><strong>Turn:</strong> {gameState.isWhiteTurn ? "White" : "Black"}</p>
                            {moveTimeoutSec != null && (
                                <p><strong>Time to turn:</strong> {formatDuration(remainingSeconds)}</p>
                            )}
                            <p><strong>Total pot:</strong> {formatEth(gameState.betAmount)}</p>
                            <div style={{fontSize: "0.8em", color: "#666"}}>
                                <p>White: {gameState.playerWhite}</p>
                                <p>Black: {gameState.playerBlack}</p>
                            </div>
                        </div>
                        <div style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            marginTop: 10,
                            alignItems: "center",
                            width: "100%"
                        }}>
                            <button
                                onClick={claimTimeout}
                                disabled={(!gameState.isActive) || (remainingSeconds != null && remainingSeconds > 0)}
                                style={{cursor: "pointer", width: "200px"}}
                            >
                                Claim Timeout
                            </button>
                            <button onClick={resign} disabled={!canResign} style={{cursor: "pointer", width: "200px"}}>Resign
                            </button>
                            <button onClick={cancel} disabled={!canCancel} style={{cursor: "pointer", width: "200px"}}>Cancel
                                Game
                            </button>
                            <button onClick={offerDraw} disabled={!canOfferDraw}
                                    style={{cursor: "pointer", width: "200px"}}>Offer Draw
                            </button>
                            <button onClick={acceptDraw} disabled={!canAcceptDraw}
                                    style={{cursor: "pointer", width: "200px"}}>Accept Draw
                            </button>
                        </div>
                    </div>
                )}

                {/* Right column: board + move input */}
                <div style={{display: "flex", flexDirection: "column", alignItems: "center"}}>
                    <div style={{height: 500, width: 500}}>
                        <Chessboard
                            id="BasicBoard"
                            position={chessPosition}
                            onPieceDrop={onDrop}
                            boardWidth={500}
                            boardOrientation={boardOrientation}
                            arePiecesDraggable={canMovePieces}
                        />
                    </div>
                    <div style={{marginTop: 12}}>
                        <input
                            value={uciInput}
                            onChange={(e) => setUciInput(e.target.value)}
                            placeholder="UCI (e.g. e2e4)"
                            style={{marginRight: 8, padding: 5}}
                        />
                        <button onClick={submitUciMove} disabled={!canMovePieces}>Make Move</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;

import pytest
from fastapi.testclient import TestClient
from backend_validator import app # Импортируем наше приложение
import chess
import os
client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_env():
    os.environ["PRIVATE_KEY"] = "0x0000000000000000000000000000000000000000000000000000000000000001"

def test_valid_move_in_progress():
    """
    Тест обычного хода: игра продолжается.
    """
    move = "e2e4"

    response = client.post("/validate_move", json={
        "fen": chess.STARTING_FEN,
        "uci_move": move
    })

    assert response.status_code == 200
    data = response.json()

    expected_board = chess.Board()
    expected_board.push(chess.Move.from_uci(move))

    assert data["new_fen"] == expected_board.fen()
    assert data["game_over"] is False
    assert data["result"] is None
    assert isinstance(data["signature"], str)

def test_checkmate_move():
    """
    Black should win.
    """
    fen_before_mate = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2"
    mate_move = "d8h4"

    response = client.post("/validate_move", json={
        "fen": fen_before_mate,
        "uci_move": mate_move
    })

    assert response.status_code == 200
    data = response.json()

    assert data["game_over"] is True
    assert data["result"] == "0-1"
    assert isinstance(data["signature"], str)

def test_illegal_move_logic():
    start_fen = chess.STARTING_FEN
    illegal_move = "g1g4" # Конь так не ходит

    response = client.post("/validate_move", json={
        "fen": start_fen,
        "uci_move": illegal_move
    })
    assert response.status_code == 422



def test_invalid_fen_syntax():
    response = client.post("/validate_move", json={
        "fen": "not a fen string",
        "uci_move": "e2e4"
    })

    assert response.status_code == 422

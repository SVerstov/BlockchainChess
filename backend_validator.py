import os

from chess import Board, Move
from fastapi import FastAPI
from pydantic import BaseModel, model_validator
from dotenv import load_dotenv
from eth_account import Account, messages


load_dotenv()
app = FastAPI()


class MoveRequest(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    fen: str
    uci_move: str
    move: Move | None = None
    board: Board | None = None

    @model_validator(mode="after")
    def validate_move_legality(self):
        self.board = Board(self.fen)
        self.move = Move.from_uci(self.uci_move)
        if not self.board.is_legal(self.move):
            raise ValueError("Invalid move")
        return self

class MoveResponse(BaseModel):
    new_fen: str
    game_over: bool
    result: str | None  #  ``1-0``, ``0-1`` or ``1/2-1/2``
    signature: str

def sign_message(message: str, private_key: str) -> str:
    """ Sign message (EIP-191)"""
    signable_message = messages.encode_defunct(text=message)
    signed_message = Account.sign_message(signable_message, private_key)
    return signed_message.signature.hex()


@app.post("/validate_move")
def validate_move(move_request: MoveRequest):
    """
    Validate if a move is legal in the given FEN position.
    :param move_request:
    :return:
    """
    board = move_request.board
    move = Move.from_uci(move_request.uci_move)
    board = move_request.board
    board.push(move_request.move)
    new_fen = board.fen()
    outcome = board.outcome()
    game_over = outcome is not None
    result = outcome.result() if game_over else None
    signature = sign_message(f"{new_fen}|{result}", os.getenv("PRIVATE_KEY"))  # Replace with actual private key management

    return MoveResponse(
        new_fen=new_fen,
        game_over=game_over,
        result=result,
        signature=signature,
    )



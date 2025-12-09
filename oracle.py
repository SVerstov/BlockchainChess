import os
from contextlib import asynccontextmanager
from enum import IntEnum

from chess import Board, Move
from fastapi import FastAPI
from pydantic import BaseModel, model_validator
from dotenv import load_dotenv
from eth_account import Account, messages
from starlette.middleware.cors import CORSMiddleware
from web3 import Web3, Account

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    address = Account.from_key(os.getenv("PRIVATE_KEY")).address
    print(f"Eth address for your PK:\n{address}")
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # todo only for testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Result(IntEnum):
    in_progress = 0
    white_win = 1
    black_win = 2
    draw = 3

    @classmethod
    def _missing_(cls, value):
        if value == "":
            return Result.in_progress
        elif value == "1-0":
            return Result.white_win
        elif value == "0-1":
            return Result.black_win
        elif value == "1/2-1/2":
            return Result.draw


class MoveRequest(BaseModel):
    model_config = {"arbitrary_types_allowed": True}
    game_id: int
    fen: str
    uci_move: str
    move: Move | None = None
    board: Board | None = None

    @model_validator(mode="after")
    def validate_move(self):
        self.board = Board(self.fen)
        self.move = Move.from_uci(self.uci_move)
        if not self.board.is_legal(self.move):
            raise ValueError("Invalid move")
        return self

class MoveResponse(BaseModel):
    game_id: int
    new_fen: str
    game_over: bool
    result: Result
    signature: str

def sign_move(move: MoveRequest, new_fen, result: Result) -> str:
    """ Sign move (EIP-191)"""
    msg_hash = Web3.solidity_keccak(
        ["uint256", "string", "string", "uint8"], [move.game_id, move.fen, new_fen, result.value]
    )
    signable_message = messages.encode_defunct(hexstr=msg_hash.hex())
    signed_message = Account.sign_message(signable_message, os.getenv("PRIVATE_KEY"))
    return "0x" + signed_message.signature.hex()


@app.post("/validate_move")
def validate_move(move_request: MoveRequest):
    """
    Validate if a move is legal in the given FEN position.
    :param move_request:
    :return:
    """
    board = move_request.board
    board.push(move_request.move)
    new_fen = board.fen()
    outcome = board.outcome()
    game_over = outcome is not None
    result = Result(outcome.result() if game_over else "")
    signature = sign_move(move_request, new_fen, result)  # Replace with actual private key management

    return MoveResponse(
        game_id=move_request.game_id,
        new_fen=new_fen,
        game_over=game_over,
        result=result,
        signature=signature,
    )



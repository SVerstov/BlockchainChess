// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

error InvalidBetAmount(uint256 required, uint256 sent);

contract Chess {
    address public oracleAddress;
    uint256 public moveTimeout = 1 days;
    string public constant startingFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    uint256 public gameCounter = 0;
    mapping(uint256 => Game) public games;

    struct Game {
        uint256 gameId;
        address playerWhite;
        address playerBlack;
        string fen;
        uint256 lastMoveTimestamp;
        uint256 betAmount;
        bool isActive;
        bool isWhiteTurn;
    }

    enum Result{
        InProgress, WhiteWon, BlackWon, Draw
    }


    constructor(address _oracleAddress, uint256 _moveTimeout) {
        oracleAddress = _oracleAddress;
        moveTimeout = _moveTimeout; // in days

    }

    function _getActiveGame(uint256 _gameId) internal view returns (Game storage) {
        Game storage game = games[_gameId];
        require(game.isActive, "Game is not active");
        return game;
    }

    function newGame() public payable returns (uint256) {
        gameCounter++;
        games[gameCounter] = Game({
            gameId: gameCounter,
            playerWhite: msg.sender,
            playerBlack: address(0),
            fen: startingFEN,
            lastMoveTimestamp: block.timestamp,
            betAmount: msg.value, // sum of bets from both players
            isActive: true,
            isWhiteTurn: true
        });
        return gameCounter;
    }

    function joinGame(uint256 _gameId) public payable {
        Game storage game = _getActiveGame(_gameId);
        require(game.playerBlack == address(0), "Game already has two players");
        require(game.playerWhite != msg.sender, "Cannot join your own game");
        if (msg.value != game.betAmount) {
            revert InvalidBetAmount(game.betAmount, msg.value);
        }
        game.playerBlack = msg.sender;
        game.betAmount += msg.value;
    }


    function move(
        uint256 _gameId,
        string memory _newFen,
        uint256 _result,
        bytes memory _signature
    ) public {
        Game storage game = _getActiveGame(_gameId);
        require(
            (game.isWhiteTurn && msg.sender == game.playerWhite) ||
            (!game.isWhiteTurn && msg.sender == game.playerBlack),
            "Not your turn"
        );
        require(verifyMove(_gameId, _newFen, _result, _signature), "Invalid move signature");
        game.fen = _newFen;
        game.lastMoveTimestamp = block.timestamp;
        game.isWhiteTurn = !game.isWhiteTurn;
        if (_result != Result.InProgress) {proceedResult(game, _result);}
    }



    function proceedResult(Game storage game, Result result) internal {
        require (game.isActive, "Game is still in progress");
        game.isActive = false;
        if (result == Result.WhiteWon) {
            _safeTransfer(game.playerWhite, game.betAmount);
        } else if (result == Result.BlackWon) {
            _safeTransfer(game.playerBlack, game.betAmount);
        } else if (result == Result.Draw) {
            _safeTransfer(game.playerWhite, game.betAmount / 2);
            _safeTransfer(game.playerBlack, game.betAmount / 2);
        }
    }

    function _safeTransfer(address payable _recipient, uint256 _amount) internal {
        require(_recipient != address(0), "Invalid recipient");
        (bool success, ) = _recipient.call{value: _amount}("");
        require(success, "Ether transfer failed via call");
    }

    function callTimeout(uint256 _gameId) public {
        Game storage game = _getActiveGame(_gameId);
        require(block.timestamp >= game.lastMoveTimestamp + moveTimeout, "Move timeout not reached");
        require(msg.sender == game.playerWhite || msg.sender == game.playerBlack, "Only players can call timeout");
        game.isActive = false;
        if (game.isWhiteTurn) {
            // Black wins
            payable(game.playerBlack).transfer(game.betAmount);
        } else {
            // White wins
            payable(game.playerWhite).transfer(game.betAmount);
        }
    }

    function getEthSignedMessageHash(bytes32 _messageHash) public pure returns (bytes32) {
        /*
        Signature is produced by signing a keccak256 hash with the following format:
        "\x19Ethereum Signed Message\n" + len(msg) + msg
        */
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _messageHash));
    }

    function splitSignature(bytes memory sig)
    public
    pure
    returns (bytes32 r, bytes32 s, uint8 v)
    {
        require(sig.length == 65, "invalid signature length");
        assembly {
            /*
            First 32 bytes stores the length of the signature


            add(sig, 32) = pointer of sig + 32
            effectively, skips first 32 bytes of signature


            mload(p) loads next 32 bytes starting at the memory address p into memory
            */


            // first 32 bytes, after the length prefix
            r := mload(add(sig, 32))
            // second 32 bytes
            s := mload(add(sig, 64))
            // final byte (first byte of the next 32 bytes)
            v := byte(0, mload(add(sig, 96)))
        }

        // implicitly return (r, s, v)
    }

    function recoverSigner(
        bytes32 _ethSignedMessageHash,
        bytes memory _signature
    ) public pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }


    function verifyMove(uint256 _gameId, string memory _newFen, uint256 _result, bytes memory _signature) public view returns (bool) {
        bytes32 messageHash = keccak256(abi.encodePacked(_gameId, _newFen, _result));
        require(recoverSigner(getEthSignedMessageHash(messageHash), _signature) == oracleAddress, "Invalid signature");
        return true;
    }


}
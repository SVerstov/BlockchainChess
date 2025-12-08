// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

//import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Chess {
//    using ECDSA for bytes32;

    address public oracleAddress;
    uint256 public moveTimeout = 1 days;
    string public constant startingFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    struct Game {
        uint256 gameId;
        address playerWhite;
        address playerBlack;
        string currentFEN;
        uint256 lastMoveTimestamp;
        bool isActive;
    }




    constructor(address _oracleAddress, uint256 _moveTimeout) {
        oracleAddress = _oracleAddress;
        moveTimeout = _moveTimeout; // in days

    }

    function getEthSignedMessageHash(bytes32 _messageHash) public pure returns (bytes32) {
        /*
        Signature is produced by signing a keccak256 hash with the following format:
        "\x19Ethereum Signed Message\n" + len(msg) + msg
        */
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", _messageHash)
        );
    }

    function recoverSigner(
        bytes32 _ethSignedMessageHash,
        bytes memory _signature
    ) public pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);

        return ecrecover(_ethSignedMessageHash, v, r, s);
    }


    function verifyMove(uint256 _gameId, string memory _newFen, string memory _result, bytes memory _signature) public view returns (bool) {
        bytes32 messageHash = keccak256(abi.encodePacked(_gameId, _newFen, _result));
        require(recoverSigner(getEthSignedMessageHash(messageHash)) == oracleAddress, "Invalid signature");
        return true;
    }
}
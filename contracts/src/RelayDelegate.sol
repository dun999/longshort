// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Code an EOA delegates to (EIP-7702) so a relayer can submit its Arena calls.
///         Storage (the nonce) lives on the EOA. Immutables live in this bytecode, which is
///         what actually runs. The EOA's own key must have signed the call. No MON is moved,
///         so a delegated account can sit at 0 MON on Monad.
contract RelayDelegate {
    address public immutable arena;
    address public immutable stake;

    /// @dev Replay nonce. Incremented only on the EOA, and only when the call succeeds.
    uint256 public nonce;

    error BadCall();
    error BadSig();
    error Expired();
    error CallFailed();

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant EXECUTE_TYPEHASH =
        keccak256("Execute(address target,bytes data,uint256 nonce,uint256 deadline)");
    bytes32 private constant NAME_HASH = keccak256("longshort.fun");
    bytes32 private constant VERSION_HASH = keccak256("1");

    // Arena selectors this delegate is willing to forward. Must match ArenaCore.
    bytes4 private constant CREATE_MATCH = bytes4(keccak256("createMatch(uint8,uint128,uint32,uint8,uint8,uint8,address)"));
    bytes4 private constant JOIN_MATCH = bytes4(keccak256("joinMatch(uint256,uint8,uint8,address)"));
    bytes4 private constant LEAVE = bytes4(keccak256("leave(uint256)"));
    bytes4 private constant OPEN = bytes4(keccak256("open(uint256,uint8,bool,uint16)"));
    bytes4 private constant CLOSE = bytes4(keccak256("close(uint256)"));
    bytes4 private constant SET_CLASS = bytes4(keccak256("setClass(uint256,uint8)"));
    bytes4 private constant RECOVER = bytes4(keccak256("recover(uint256)"));

    uint256 private constant MAX_DATA = 1024;

    constructor(address arena_, address stake_) {
        if (arena_ == address(0) || stake_ == address(0)) revert BadCall();
        arena = arena_;
        stake = stake_;
    }

    /// @dev An empty transfer still has to land. Without this, a delegated EOA rejects plain MON.
    receive() external payable {}

    function execute(address target, bytes calldata data, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        if (!_allowed(target, data)) revert BadCall();
        bytes32 digest = _digest(address(this), target, data, nonce, deadline);
        if (ECDSA.recover(digest, signature) != address(this)) revert BadSig();
        nonce++;
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            if (ret.length == 0) revert CallFailed();
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    /// @notice Digest a signer should produce. `account` is the EOA that will delegate here.
    function digestFor(address account, address target, bytes calldata data, uint256 nonce_, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _digest(account, target, data, nonce_, deadline);
    }

    function _allowed(address target, bytes calldata data) internal view returns (bool) {
        if (data.length < 4 || data.length > MAX_DATA) return false;
        bytes4 sel = bytes4(data);
        if (target == arena) {
            return sel == CREATE_MATCH || sel == JOIN_MATCH || sel == LEAVE || sel == OPEN || sel == CLOSE || sel == SET_CLASS || sel == RECOVER;
        }
        if (target == stake && sel == IERC20.approve.selector && data.length >= 68) {
            (address spender,) = abi.decode(data[4:], (address, uint256));
            return spender == arena;
        }
        return false;
    }

    function _digest(address account, address target, bytes calldata data, uint256 nonce_, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(EXECUTE_TYPEHASH, target, keccak256(data), nonce_, deadline));
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, account));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }
}

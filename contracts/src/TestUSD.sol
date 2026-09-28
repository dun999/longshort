// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stake token with a rate-limited faucet. 6 decimals, like AUSD.
contract TestUSD is ERC20 {
    error FaucetCooldown(uint256 readyAt);

    uint256 public constant DRIP = 500e6;
    uint256 public constant COOLDOWN = 1 hours;
    mapping(address => uint256) public lastDrip;

    constructor() ERC20("longshort Test USD", "tUSD") {
        _mint(msg.sender, 1_000_000e6); // seeds bot wallets
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        uint256 readyAt = lastDrip[msg.sender] + COOLDOWN;
        if (lastDrip[msg.sender] != 0 && block.timestamp < readyAt) revert FaucetCooldown(readyAt);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, DRIP);
    }
}

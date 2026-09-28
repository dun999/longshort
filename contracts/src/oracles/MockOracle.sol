// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @notice Owner-pushed prices. Used in tests and as a fallback if the Perpl feed stalls.
contract MockOracle is IPriceOracle, Ownable {
    mapping(uint8 => uint256) public px;
    mapping(uint8 => uint256) public ts;

    constructor(address owner_) Ownable(owner_) {}

    function set(uint8 market, uint256 price_) external onlyOwner {
        px[market] = price_;
        ts[market] = block.timestamp;
    }

    function price(uint8 market) external view returns (uint256, uint256) {
        return (px[market], ts[market]);
    }
}

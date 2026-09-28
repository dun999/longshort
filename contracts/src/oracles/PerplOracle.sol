// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPerplExchange} from "../interfaces/IPerplExchange.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @notice Reads Perpl's onchain mark/oracle price. Uses whichever observation is fresher.
contract PerplOracle is IPriceOracle, Ownable {
    error UnknownMarket(uint8 market);
    error StalePrice(uint8 market, uint256 age);

    IPerplExchange public immutable exchange;
    mapping(uint8 => uint256) public perpIdOf;
    uint256 public maxAge = 60;

    constructor(IPerplExchange exchange_, address owner_) Ownable(owner_) {
        exchange = exchange_;
        perpIdOf[0] = 16; // BTC
        perpIdOf[1] = 32; // ETH
        perpIdOf[2] = 64; // MON
    }

    function setPerp(uint8 market, uint256 perpId) external onlyOwner {
        perpIdOf[market] = perpId;
    }

    function setMaxAge(uint256 maxAge_) external onlyOwner {
        maxAge = maxAge_;
    }

    function price(uint8 market) external view returns (uint256 px, uint256 ts) {
        uint256 perpId = perpIdOf[market];
        if (perpId == 0) revert UnknownMarket(market);
        IPerplExchange.PerpetualInfo memory info = exchange.getPerpetualInfo(perpId);
        uint256 raw;
        if (info.oracleTimestampSec > info.markTimestamp && info.oraclePNS != 0) {
            (raw, ts) = (info.oraclePNS, info.oracleTimestampSec);
        } else {
            (raw, ts) = (info.markPNS, info.markTimestamp);
        }
        uint256 age = block.timestamp > ts ? block.timestamp - ts : 0;
        if (raw == 0 || age > maxAge) revert StalePrice(market, age);
        px = raw * 10 ** (18 - info.priceDecimals);
    }
}

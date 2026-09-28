// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPriceOracle {
    /// @return px price scaled to 1e18
    /// @return ts unix seconds of the observation
    function price(uint8 market) external view returns (uint256 px, uint256 ts);
}

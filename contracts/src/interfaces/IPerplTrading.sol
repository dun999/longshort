// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Verified against Perpl's current Exchange artifact (dex-sdk) and Monad testnet.
interface IPerplTrading {
    struct PositionBitMap { uint256 bank1; uint256 bank2; uint256 bank3; uint256 bank4; }
    struct AccountInfo {
        uint256 accountId;
        uint256 balanceCNS;
        uint256 lockedBalanceCNS;
        uint8 frozen;
        address accountAddr;
        PositionBitMap positions;
    }
    struct PositionInfoV2 {
        uint256 accountId;
        uint256 nextNodeId;
        uint256 prevNodeId;
        uint8 positionType;
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
        int256 pnlCNS;
        int256 deltaPnlCNS;
        int256 premiumPnlCNS;
        uint256 priceResiduePNSQ16;
    }
    struct OrderDesc {
        uint256 orderDescId;
        uint256 perpId;
        uint8 orderType; // 0 long, 1 short, 2 close long, 3 close short
        uint256 orderId;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 expiryBlock;
        bool postOnly;
        bool fillOrKill;
        bool immediateOrCancel;
        uint256 maxMatches;
        uint256 leverageHdths;
        uint256 lastExecutionBlock;
        uint256 amountCNS;
        uint256 maxNegPnlCollatBPS;
    }
    struct OrderSignature { uint256 perpId; uint256 orderId; }
    function createAccount(uint256 amountCNS) external returns (uint256);
    function withdrawCollateral(uint256 amountCNS) external;
    function getMinAccountOpenCNS() external view returns (uint256);
    function getExchangeInfo() external view returns (uint256, uint256, uint256, uint256, address, address);
    function getAccountByAddr(address) external view returns (AccountInfo memory);
    function getPositionV2(uint256 perpId, uint256 accountId) external view returns (PositionInfoV2 memory, uint256, bool);
    function execOrder(OrderDesc calldata) external returns (OrderSignature memory);
}

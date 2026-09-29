// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {RelayDelegate} from "../src/RelayDelegate.sol";

/// Deploy only the sponsor delegate against an arena that is already live.
///   ARENA=0x… STAKE=0x… forge script script/DeployRelay.s.sol --rpc-url monad_testnet --broadcast --private-key $RELAYER_KEY
contract DeployRelay is Script {
    function run() external {
        address arena = vm.envAddress("ARENA");
        address stake = vm.envAddress("STAKE");
        vm.startBroadcast();
        RelayDelegate relay = new RelayDelegate(arena, stake);
        vm.stopBroadcast();
        console.log("RelayDelegate", address(relay));
    }
}

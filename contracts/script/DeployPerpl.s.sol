// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Script,console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplTrading} from "../src/interfaces/IPerplTrading.sol";
import {PerplArena} from "../src/PerplArena.sol";
import {RelayDelegate} from "../src/RelayDelegate.sol";

/// @dev Testnet only. Funding key deploys; the existing keeper remains owner on a separate nonce sequence.
contract DeployPerpl is Script {
    function run() external {
        require(block.chainid==10143,"Monad testnet only");
        uint256 key=vm.envUint("FAUCET_KEY"); address owner=vm.addr(vm.envUint("KEEPER_KEY"));
        address ausd=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
        address exchange=0x1964C32f0bE608E7D29302AFF5E61268E72080cc;
        vm.startBroadcast(key);
        PerplArena arena=new PerplArena(IERC20(ausd),IPerplTrading(exchange),owner,owner);
        RelayDelegate relay=new RelayDelegate(address(arena),ausd);
        vm.stopBroadcast();
        console2.log("PerplArena",address(arena)); console2.log("RelayDelegate",address(relay));
    }
}

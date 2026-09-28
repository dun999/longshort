// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArenaCore} from "../src/ArenaCore.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {PerplOracle} from "../src/oracles/PerplOracle.sol";
import {MockOracle} from "../src/oracles/MockOracle.sol";
import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    address constant PERPL = 0x1964C32f0bE608E7D29302AFF5E61268E72080cc;

    function run() external {
        // STAKE_TOKEN: stake in an existing ERC20 (e.g. Agora AUSD); unset = deploy a TestUSD faucet token.
        // PERPL_ORACLE: reuse an already-deployed PerplOracle instead of deploying a new one.
        address stakeToken = vm.envOr("STAKE_TOKEN", address(0));
        address reuseOracle = vm.envOr("PERPL_ORACLE", address(0));
        bool useMock = vm.envOr("USE_MOCK_ORACLE", false);

        vm.startBroadcast();
        address deployer = msg.sender;
        address stake = stakeToken != address(0) ? stakeToken : address(new TestUSD());
        address perpl = reuseOracle != address(0) ? reuseOracle : address(new PerplOracle(IPerplExchange(PERPL), deployer));
        MockOracle mock = new MockOracle(deployer); // fallback; the keeper mirrors Perpl prices into it
        IPriceOracle oracle = useMock ? IPriceOracle(address(mock)) : IPriceOracle(perpl);
        ArenaCore arena = new ArenaCore(IERC20(stake), oracle, deployer, deployer);
        vm.stopBroadcast();

        string memory j = "deploy";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployBlock", block.number);
        vm.serializeAddress(j, "stake", stake);
        vm.serializeString(j, "stakeSymbol", IERC20Metadata(stake).symbol());
        vm.serializeAddress(j, "perplOracle", perpl);
        vm.serializeAddress(j, "mockOracle", address(mock));
        vm.serializeAddress(j, "perplExchange", PERPL);
        vm.serializeBool(j, "mockOracleActive", useMock);
        string memory out = vm.serializeAddress(j, "arena", address(arena));
        vm.writeJson(out, "../packages/shared/src/addresses.json");
        console.log("ArenaCore", address(arena));
        console.log("stake", stake);
    }
}

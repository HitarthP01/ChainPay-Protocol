require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    // Local Hardhat network for development
    hardhat: {
      chainId: 1337,
      mining: {
        auto: true,
        interval: 1000 // Mine a block every second for realistic simulation
      },
      accounts: {
        count: 20,
        accountsBalance: "10000000000000000000000" // 10000 ETH each
      }
    },
    // External Hardhat node (run with `npx hardhat node`)
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};

require("dotenv").config();

require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");

const { parseUnits } = require("ethers/lib/utils");

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.4",
  networks: {
    hardhat: {
      forking: {
        url: process.env.POLYGON_URL || "",
        enabled: true,
        blockNumber: 23231719
      },
      blockGasLimit: 20000000,
      gasPrice: 30000000000,
      accounts: [{privateKey: `0x${process.env.TESTNET_PRIVATE_KEY}`, balance: parseUnits("10000", 18).toString()}],
      saveDeployments: false
    },
    mumbai: {
      url: process.env.MUMBAI_URL,
      accounts: [`0x${process.env.TESTNET_PRIVATE_KEY}`]
    },
    // polygon: {
    //   url: process.env.POLYGON_URL,
    //   blockGasLimit: 20000000,
    //   gasPrice: 35000000000,
    //   accounts: [`0x${process.env.MAINNET_PRIVATE_KEY}`]
    // }
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.POLYGONSCAN_API_KEY,
  },
  mocha: {
    timeout: 0
  }
};

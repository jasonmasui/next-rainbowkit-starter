import { BigNumber, utils } from "ethers"
const toEther = (val: any): BigNumber => utils.parseEther(String(val))

const OUTPUT_FILE = "./scripts/deployment/output/holesky.json"
const TX_CONFIRMATIONS = 2
const ETHERSCAN_BASE_URL = "https://holesky.etherscan.io/address"

const CONTRACT_UPGRADES_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const SYSTEM_PARAMS_ADMIN = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"
const TREASURY_WALLET = "0x19596e1D6cd97916514B5DBaA4730781eFE49975"

const COLLATERAL = [
	{
		name: "MockLST1",
		address: "0xB77581012975C857890e35BdEB97b834f4c26782",
		oracleAddress: "0xBD9BEBcbAE2851381E1d248b973D8598f0408658",
		oracleTimeoutSeconds: 90_000,
		oracleIsEthIndexed: false,
		borrowingFee: toEther(0.01),
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(200),
		gasCompensation: toEther(20),
		mintCap: toEther(5_000_000),
	},
	{
		name: "g(MockLST1)",
		address: "0xe898eFDA0605493116CD7E6e11B70A731e89E8f6",
		oracleAddress: "0x16B32a71149Dc1C5Aa4a977719D846feedA39fc9",
		oracleTimeoutSeconds: 90_000,
		oracleIsEthIndexed: false,
		borrowingFee: toEther(0.01),
		MCR: toEther(1.111),
		CCR: toEther(1.4),
		minNetDebt: toEther(200),
		gasCompensation: toEther(20),
		mintCap: toEther(5_000_000),
	}

]

module.exports = {
	COLLATERAL,
	CONTRACT_UPGRADES_ADMIN,
	ETHERSCAN_BASE_URL,
	OUTPUT_FILE,
	SYSTEM_PARAMS_ADMIN,
	TREASURY_WALLET,
	TX_CONFIRMATIONS,
}
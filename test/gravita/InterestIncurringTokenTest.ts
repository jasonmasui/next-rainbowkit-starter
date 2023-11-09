import { artifacts, assert, contract, ethers, network } from "hardhat"
import {
	setBalance,
	time,
	impersonateAccount,
	stopImpersonatingAccount,
} from "@nomicfoundation/hardhat-network-helpers"
import { AddressZero, MaxUint256, WeiPerEther } from "@ethersproject/constants"
import { BigNumber } from "ethers"

const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper

const InterestIncurringToken = artifacts.require("InterestIncurringToken")

const f = (v: any) => ethers.utils.formatEther(v.toString())
const bn = (v: any) => ethers.utils.parseEther(v.toString())

let contracts: any,
	adminContract: any,
	borrowerOperations: any,
	debtToken: any,
	erc20: any,
	feeCollector: any,
	priceFeed: any,
	sortedVessels: any,
	stabilityPool: any,
	vesselManager: any,
	vesselManagerOperations: any

const deploy = async (treasury: string, mintingAccounts: string[]) => {
	contracts = await deploymentHelper.deployTestContracts(treasury, mintingAccounts)
	adminContract = contracts.core.adminContract
	borrowerOperations = contracts.core.borrowerOperations
	debtToken = contracts.core.debtToken
	erc20 = contracts.core.erc20
	feeCollector = contracts.core.feeCollector
	priceFeed = contracts.core.priceFeedTestnet
	sortedVessels = contracts.core.sortedVessels
	stabilityPool = contracts.core.stabilityPool
	vesselManager = contracts.core.vesselManager
	vesselManagerOperations = contracts.core.vesselManagerOperations
}

contract("InterestIncurringToken", async accounts => {
	const debug = true
	let snapshotId: number, initialSnapshotId: number
	const [treasury, alice, bob, carol, whale] = accounts
	let vault: any
	let interestRate, autoTransfer

	before(async () => {
		await deploy(treasury, [])

		interestRate = 200 // 2%
		autoTransfer = 30 * 86_400 // 30 days timeout

		vault = await InterestIncurringToken.new(
			erc20.address,
			"InterestToken",
			"INTTKN",
			feeCollector.address,
			interestRate,
			autoTransfer
		)
		await vault.initialize()
		await adminContract.addNewCollateral(vault.address, bn(200), 18)
		await adminContract.setIsActive(vault.address, true)

		initialSnapshotId = await network.provider.send("evm_snapshot")
	})

	beforeEach(async () => {
		snapshotId = await network.provider.send("evm_snapshot")
	})

	afterEach(async () => {
		await network.provider.send("evm_revert", [snapshotId])
	})

	after(async () => {
		await network.provider.send("evm_revert", [initialSnapshotId])
	})

	it("deposit and withdraw happy path", async () => {
		const assetAmountAlice = bn(100_000)
		const assetAmountBob = bn(200_000)
		const assetAmountCarol = bn(300_000)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.mint(bob, assetAmountBob)
		await erc20.mint(carol, assetAmountCarol)
		debug && console.log(`Alice's assets: ${f(await erc20.balanceOf(alice))}`)
		debug && console.log(`Bob's assets: ${f(await erc20.balanceOf(bob))}`)
		debug && console.log(`Carol's assets: ${f(await erc20.balanceOf(carol))}`)
		debug && console.log(`Approving...`)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await erc20.approve(vault.address, MaxUint256, { from: bob })
		await erc20.approve(vault.address, MaxUint256, { from: carol })
		debug && console.log(`Depositing...`)
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		await vault.deposit(assetAmountBob, bob, { from: bob })
		await vault.deposit(assetAmountCarol, carol, { from: carol })
		debug && console.log(`Alice's assets: ${f(await erc20.balanceOf(alice))}`)
		debug && console.log(`Alice's shares: ${f(await vault.balanceOf(alice))}`)
		debug && console.log(`Bob's assets: ${f(await erc20.balanceOf(bob))}`)
		debug && console.log(`Bob's shares: ${f(await vault.balanceOf(bob))}`)
		debug && console.log(`Carol's assets: ${f(await erc20.balanceOf(carol))}`)
		debug && console.log(`Carol's shares: ${f(await vault.balanceOf(carol))}`)
		debug && console.log(`... one year goes by ...`)
		await time.increase(365 * 86_400)
		debug && console.log(`Collecting...`)
		await vault.collectInterest()
		const assetAmountTreasury = await erc20.balanceOf(treasury)
		const expectedAssetAmountTreasury = bn(0.02 * 600_000) // 2% of total deposited
		debug && console.log(`Treasury's assets: ${f(assetAmountTreasury)}`)
		debug && console.log(`Treasury's shares: ${f(await vault.balanceOf(treasury))}`)
		assertIsApproximatelyEqual(assetAmountTreasury, expectedAssetAmountTreasury)
		debug && console.log(`Withdrawing...`)
		await vault.redeem(await vault.balanceOf(alice), alice, alice, { from: alice })
		await vault.redeem(await vault.balanceOf(bob), bob, bob, { from: bob })
		await vault.redeem(await vault.balanceOf(carol), carol, carol, { from: carol })
		assert.equal("0", await vault.balanceOf(alice))
		assert.equal("0", await vault.balanceOf(bob))
		assert.equal("0", await vault.balanceOf(carol))
		const finalAssetAmountAlice = await erc20.balanceOf(alice)
		const expectedFinalAssetAmountAlice = 0.98 * Number(assetAmountAlice)
		const finalAssetAmountBob = await erc20.balanceOf(bob)
		const expectedFinalAssetAmountBob = 0.98 * Number(assetAmountBob)
		const finalAssetAmountCarol = await erc20.balanceOf(carol)
		const expectedFinalAssetAmountCarol = 0.98 * Number(assetAmountCarol)
		debug && console.log(`Alice's assets: ${f(finalAssetAmountAlice)}`)
		debug && console.log(`Bob's assets: ${f(finalAssetAmountBob)}`)
		debug && console.log(`Carol's assets: ${f(finalAssetAmountCarol)}`)
		assertIsApproximatelyEqual(finalAssetAmountAlice, expectedFinalAssetAmountAlice)
		assertIsApproximatelyEqual(finalAssetAmountBob, expectedFinalAssetAmountBob)
		assertIsApproximatelyEqual(finalAssetAmountCarol, expectedFinalAssetAmountCarol)
	})

	it("5% interest rate, new shares should reflect discounts", async () => {
		debug && console.log(`Setting interest rate to 5%`)
		await vault.setInterestRate(500)
		debug && console.log(`Alice deposits...`)
		const assetAmountAlice = bn(100_000)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		debug && console.log(`... one year goes by ...`)
		await time.increase(365 * 86_400)
		debug && console.log(`Bob deposits...`)
		const assetAmountBob = bn(100_000)
		await erc20.mint(bob, assetAmountBob)
		await erc20.approve(vault.address, MaxUint256, { from: bob })
		await vault.deposit(assetAmountBob, bob, { from: bob })
		const assetsInVault = await vault.totalAssets()
		const shareAmountBob = await vault.balanceOf(bob)
		const expectedAssetsInVault = 100_000 + 100_000 * 0.95
		debug && console.log(`Vault's assets: ${f(assetsInVault)}`)
		assertIsApproximatelyEqual(assetsInVault, bn(expectedAssetsInVault))
		const assetProportionBob = 100_000 / expectedAssetsInVault
		const expectedShareAmountBob = bnMulDec(await vault.totalSupply(), assetProportionBob)
		debug && console.log(`expectedShareAmountBob: ${String(expectedShareAmountBob)}`)
		debug && console.log(`Alice's shares: ${f(await vault.balanceOf(alice))}`)
		debug && console.log(`Bob's shares: ${f(shareAmountBob)} (actual)`)
		debug && console.log(`Bob's shares: ${f(expectedShareAmountBob.toString())} (expected)`)
		assertIsApproximatelyEqual(shareAmountBob, expectedShareAmountBob)
	})

	it("liquidating a vessel should unwrap underlying token to borrower and liquidator", async () => {
		assert.equal(await debtToken.balanceOf(treasury), "0")
		assert.equal(await erc20.balanceOf(treasury), "0")
		assert.equal(await vault.balanceOf(treasury), "0")

		// price starts at $2,000
		await priceFeed.setPrice(vault.address, bn(2_000))

		// whale opens a vessel & deposits in the SP
		const assetAmountWhale = bn(10_000)
		await erc20.mint(whale, assetAmountWhale)
		await erc20.approve(vault.address, MaxUint256, { from: whale })
		await vault.deposit(assetAmountWhale, whale, { from: whale })
		const vaultAmountwhale = await vault.balanceOf(whale)
		await vault.approve(borrowerOperations.address, MaxUint256, { from: whale })
		const loanAmountWhale = bn(200_000)
		await borrowerOperations.openVessel(vault.address, vaultAmountwhale, loanAmountWhale, AddressZero, AddressZero, {
			from: whale,
		})
		await stabilityPool.provideToSP(loanAmountWhale, [], { from: whale })

		// alice opens a vessel
		const assetAmountAlice = bn(100)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		const vaultAmountAlice = await vault.balanceOf(alice)
		const collValueAlice = bnMulDiv(vaultAmountAlice, await priceFeed.getPrice(vault.address), 1e18)
		const loanAmountAlice = bnMulDec(collValueAlice, 0.8) // 80% LTV
		await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })
		debug && console.log(`vaultPrice: ${f(await priceFeed.getPrice(vault.address))}`)
		debug && console.log(`vaultAmountAlice: ${f(vaultAmountAlice)}`)
		debug && console.log(`collValueAlice: ${f(collValueAlice)}`)
		debug && console.log(`loanAmountAlice: ${f(loanAmountAlice)}`)
		await borrowerOperations.openVessel(vault.address, vaultAmountAlice, loanAmountAlice, AddressZero, AddressZero, {
			from: alice,
		})

		// one year goes by
		await time.increase(365 * 86_400)

		// price drops to $1,500, reducing Alice's ICR below MCR
		await priceFeed.setPrice(vault.address, bn(1_500))

		// confirm system is not in Recovery Mode
		assert.isFalse(await th.checkRecoveryMode(contracts.core, vault.address))

		// liquidate vessel
		const liquidator = carol
		await vesselManagerOperations.liquidate(vault.address, alice, { from: liquidator })

		// check the vessel is successfully closed, and removed from sortedList
		const status_Asset = (await vesselManager.Vessels(alice, vault.address))[th.VESSEL_STATUS_INDEX]
		const status_ClosedByLiquidation = "3"
		assert.equal(status_Asset.toString(), status_ClosedByLiquidation)
		assert.isFalse(await sortedVessels.contains(vault.address, alice))

		// liquidator earned some underlying (unwrapped) vault asset as gas compensation (~0,5%))
		const liquidatorErc20Balance = await erc20.balanceOf(liquidator)
		const expectedLiquidatorErc2Balance = bnMulDec(bnMulDec(assetAmountAlice, 0.98), 0.005)
		debug && console.log(`Liquidator's erc20: ${f(liquidatorErc20Balance)} (actual)`)
		debug && console.log(`Liquidator's erc20: ${f(expectedLiquidatorErc2Balance)} (expected)`)
		assertIsApproximatelyEqual(liquidatorErc20Balance, expectedLiquidatorErc2Balance)

		// whale earned vault gains from his deposit in the SP (expected to be alice's coll minus 0,5% liquidator's fee)
		const whaleVaultGains = (await stabilityPool.getDepositorGains(whale, [vault.address]))[1][0]
		const expectecWhaleVaultGains = bnMulDec(assetAmountAlice, 0.995)
		debug && console.log(`StabilityPool whale vault gains: ${f(whaleVaultGains)} (actual)`)
		debug && console.log(`StabilityPool whale vault gains: ${f(expectecWhaleVaultGains)} (expected)`)
		assertIsApproximatelyEqual(whaleVaultGains, expectecWhaleVaultGains)

		// no unwrapped erc20's should have been sent to the SP
		const spErc20Balance = await erc20.balanceOf(stabilityPool.address)
		debug && console.log(`StabilityPool erc20 balance: ${f(spErc20Balance)}`)
		assert.equal("0", spErc20Balance.toString())
	})

	it("adjusting and closing vessel should return unwrapped collateral to borrower", async () => {
		await priceFeed.setPrice(vault.address, bn(2_000))
		debug && console.log(`Setting interest rate to 4%`)
		await vault.setInterestRate(400)
		// whale opens a vessel
		const assetAmountWhale = bn(10_000)
		await erc20.mint(whale, assetAmountWhale)
		await erc20.approve(vault.address, MaxUint256, { from: whale })
		await vault.deposit(assetAmountWhale, whale, { from: whale })
		const vaultAmountwhale = await vault.balanceOf(whale)
		await vault.approve(borrowerOperations.address, MaxUint256, { from: whale })
		const loanAmountWhale = bn(200_000)
		await borrowerOperations.openVessel(vault.address, vaultAmountwhale, loanAmountWhale, AddressZero, AddressZero, {
			from: whale,
		})

		// alice opens a vessel
		const assetAmountAlice = bn(100)
		await erc20.mint(alice, assetAmountAlice)
		await erc20.approve(vault.address, MaxUint256, { from: alice })
		await vault.deposit(assetAmountAlice, alice, { from: alice })
		const vaultAmountAlice = await vault.balanceOf(alice)
		const collValueAlice = bnMulDiv(vaultAmountAlice, await priceFeed.getPrice(vault.address), 1e18)
		const loanAmountAlice = bnMulDec(collValueAlice, 0.8) // 80% LTV
		await vault.approve(borrowerOperations.address, MaxUint256, { from: alice })
		debug && console.log(`Alice opens vessel, borrowing $${f(loanAmountAlice)} GRAI...`)
		await borrowerOperations.openVessel(vault.address, vaultAmountAlice, loanAmountAlice, AddressZero, AddressZero, {
			from: alice,
		})

		// half a year goes by
		await time.increase(182.5 * 86_400)

		// alice adjusts her vessel, withdrawing 50% of her collateral
		const collWithdrawAmount = bnMulDec(vaultAmountAlice, .5)
		const debtTokenChange = bnMulDec(loanAmountAlice, .5)
		assert.equal("0", await erc20.balanceOf(alice))
		assert.equal("0", await vault.balanceOf(alice))
		debug && console.log(`Alice adjusts vessel (50% payback + 50% coll withdraw)...`)
		await borrowerOperations.adjustVessel(vault.address, 0, collWithdrawAmount, debtTokenChange, false, AddressZero, AddressZero, {
			from: alice,
		})
		const assetBalanceAlice1 = await erc20.balanceOf(alice)
		const expectedAssetBalanceAlice1 = bnMulDec(assetAmountAlice, .5 * .98) // discount for 2% interest
		debug && console.log(`Asset Balance Alice: ${f(assetBalanceAlice1)} (actual)`)
		debug && console.log(`Asset Balance Alice: ${f(expectedAssetBalanceAlice1)} (expected)`)
		assert.equal("0", await vault.balanceOf(alice))
		assertIsApproximatelyEqual(assetBalanceAlice1, expectedAssetBalanceAlice1)

		// another half of a year goes by
		await time.increase(182.5 * 86_400)

		// alice closes her vessel
		const borrowingFeeAlice = bnMulDec(loanAmountAlice, .005)
		await debtToken.transfer(alice, borrowingFeeAlice, { from: whale }) // whale kindly transfers change for borrowing fee
		debug && console.log(`Alice closes vessel...`)
		await borrowerOperations.closeVessel(vault.address, { from: alice })
		assert.equal("0", await vault.balanceOf(alice))
		const assetBalanceAlice2 = await erc20.balanceOf(alice)
		const expectedAssetBalanceAlice2 = bnMulDec(assetAmountAlice, .5 * .98).add(bnMulDec(assetAmountAlice, .5 * .96)) // half @ 2% + half @ 4%
		debug && console.log(`Asset Balance Alice: ${f(assetBalanceAlice2)} (actual)`)
		debug && console.log(`Asset Balance Alice: ${f(expectedAssetBalanceAlice2)} (expected)`)
		assert.equal("0", await vault.balanceOf(alice))
		assertIsApproximatelyEqual(assetBalanceAlice2, expectedAssetBalanceAlice2, 0.1)
	})
})

/**
 * Compares x and y, accepting a default error margin of 0.001%
 */
function assertIsApproximatelyEqual(x: any, y: any, errorPercent = 0.001) {
	const margin = Number(x) * (errorPercent / 100)
	const diff = Math.abs(Number(x) - Number(y))
	assert.isAtMost(diff, margin)
}

/**
 * Multiplies a BigNumber(ish) by a decimal
 */
function bnMulDec(x: any, y: number) {
	const precision = 1e12
	const multiplicand = BigNumber.from(x.toString())
	const multiplier = BigNumber.from(Math.floor(y * precision).toString())
	const divisor = BigNumber.from(precision)
	return multiplicand.mul(multiplier).div(divisor)
}

function bnMulDiv(x: any, y: any, z: any) {
	const xBn = BigNumber.from(x.toString())
	const yBn = BigNumber.from(y.toString())
	const zBn = BigNumber.from(z.toString())
	return xBn.mul(yBn).div(zBn)
}

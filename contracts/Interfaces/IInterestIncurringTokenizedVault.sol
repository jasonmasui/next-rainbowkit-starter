// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IInterestIncurringTokenizedVault is IERC4626 {

	function setInterestRate(uint256 _interestRateInBPS) external;

	function getCollectableInterest() external view returns (uint256);

	function collectInterest() external;
}


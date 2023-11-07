// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IInterestIncurringToken {
  
	function setInterestRate(uint256 _interestRateInBPS) external;

	function collectInterest() external;
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RewardTreasury
 * @dev Manages micro-payouts for Watch-to-Earn ad viewing rewards
 * @notice This contract holds the treasury funds and processes reward claims
 */
contract RewardTreasury {
    // ============ State Variables ============
    
    address public owner;
    address public rewardSigner; // Backend server's address authorized to sign rewards
    
    uint256 public totalRewardsDistributed;
    uint256 public totalClaimsProcessed;
    uint256 public rewardPerHeartbeat; // Wei per ad-view heartbeat (default: 1000 wei)
    
    // Track claimed rewards to prevent double-spending
    mapping(bytes32 => bool) public claimedRewards;
    
    // Track total earnings per user
    mapping(address => uint256) public userTotalEarnings;
    
    // ============ Events ============
    
    event RewardClaimed(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed claimId,
        uint256 timestamp
    );
    
    event TreasuryFunded(
        address indexed funder,
        uint256 amount,
        uint256 newBalance
    );
    
    event RewardSignerUpdated(
        address indexed oldSigner,
        address indexed newSigner
    );
    
    event RewardRateUpdated(
        uint256 oldRate,
        uint256 newRate
    );
    
    event EmergencyWithdrawal(
        address indexed to,
        uint256 amount
    );
    
    // ============ Modifiers ============
    
    modifier onlyOwner() {
        require(msg.sender == owner, "RewardTreasury: caller is not owner");
        _;
    }
    
    modifier onlyRewardSigner() {
        require(msg.sender == rewardSigner, "RewardTreasury: caller is not reward signer");
        _;
    }
    
    // ============ Constructor ============
    
    constructor(address _rewardSigner) payable {
        require(_rewardSigner != address(0), "RewardTreasury: invalid signer address");
        
        owner = msg.sender;
        rewardSigner = _rewardSigner;
        rewardPerHeartbeat = 1000 wei; // Default: 1000 wei per heartbeat
        
        if (msg.value > 0) {
            emit TreasuryFunded(msg.sender, msg.value, msg.value);
        }
    }
    
    // ============ External Functions ============
    
    /**
     * @notice Fund the treasury with ETH for rewards
     */
    function fundTreasury() external payable {
        require(msg.value > 0, "RewardTreasury: must send ETH");
        emit TreasuryFunded(msg.sender, msg.value, address(this).balance);
    }
    
    /**
     * @notice Process a direct reward payout (called by backend)
     * @param recipient Address to receive the reward
     * @param amount Amount in wei to send
     * @param claimId Unique identifier for this claim
     */
    function processReward(
        address payable recipient,
        uint256 amount,
        bytes32 claimId
    ) external onlyRewardSigner {
        require(recipient != address(0), "RewardTreasury: invalid recipient");
        require(amount > 0, "RewardTreasury: amount must be positive");
        require(!claimedRewards[claimId], "RewardTreasury: reward already claimed");
        require(address(this).balance >= amount, "RewardTreasury: insufficient treasury balance");
        
        // Mark as claimed before transfer (reentrancy protection)
        claimedRewards[claimId] = true;
        
        // Update statistics
        totalRewardsDistributed += amount;
        totalClaimsProcessed += 1;
        userTotalEarnings[recipient] += amount;
        
        // Transfer reward
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "RewardTreasury: transfer failed");
        
        emit RewardClaimed(recipient, amount, claimId, block.timestamp);
    }
    
    /**
     * @notice Batch process multiple rewards in one transaction (gas efficient)
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts in wei
     * @param claimIds Array of unique claim identifiers
     */
    function batchProcessRewards(
        address payable[] calldata recipients,
        uint256[] calldata amounts,
        bytes32[] calldata claimIds
    ) external onlyRewardSigner {
        require(
            recipients.length == amounts.length && amounts.length == claimIds.length,
            "RewardTreasury: array length mismatch"
        );
        require(recipients.length > 0, "RewardTreasury: empty batch");
        require(recipients.length <= 100, "RewardTreasury: batch too large");
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        require(address(this).balance >= totalAmount, "RewardTreasury: insufficient treasury balance");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "RewardTreasury: invalid recipient");
            require(amounts[i] > 0, "RewardTreasury: amount must be positive");
            require(!claimedRewards[claimIds[i]], "RewardTreasury: reward already claimed");
            
            claimedRewards[claimIds[i]] = true;
            totalRewardsDistributed += amounts[i];
            totalClaimsProcessed += 1;
            userTotalEarnings[recipients[i]] += amounts[i];
            
            (bool success, ) = recipients[i].call{value: amounts[i]}("");
            require(success, "RewardTreasury: transfer failed");
            
            emit RewardClaimed(recipients[i], amounts[i], claimIds[i], block.timestamp);
        }
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Update the reward signer address
     * @param _newSigner New signer address
     */
    function setRewardSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "RewardTreasury: invalid signer address");
        
        address oldSigner = rewardSigner;
        rewardSigner = _newSigner;
        
        emit RewardSignerUpdated(oldSigner, _newSigner);
    }
    
    /**
     * @notice Update the reward rate per heartbeat
     * @param _newRate New rate in wei
     */
    function setRewardRate(uint256 _newRate) external onlyOwner {
        require(_newRate > 0, "RewardTreasury: rate must be positive");
        
        uint256 oldRate = rewardPerHeartbeat;
        rewardPerHeartbeat = _newRate;
        
        emit RewardRateUpdated(oldRate, _newRate);
    }
    
    /**
     * @notice Emergency withdrawal of treasury funds
     * @param to Address to send funds
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "RewardTreasury: invalid address");
        require(amount <= address(this).balance, "RewardTreasury: insufficient balance");
        
        (bool success, ) = to.call{value: amount}("");
        require(success, "RewardTreasury: withdrawal failed");
        
        emit EmergencyWithdrawal(to, amount);
    }
    
    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "RewardTreasury: invalid owner address");
        owner = newOwner;
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get treasury balance
     */
    function getTreasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @notice Get user's total earnings
     * @param user User address
     */
    function getUserEarnings(address user) external view returns (uint256) {
        return userTotalEarnings[user];
    }
    
    /**
     * @notice Check if a claim has been processed
     * @param claimId Claim identifier
     */
    function isClaimProcessed(bytes32 claimId) external view returns (bool) {
        return claimedRewards[claimId];
    }
    
    /**
     * @notice Get treasury statistics
     */
    function getStats() external view returns (
        uint256 balance,
        uint256 totalDistributed,
        uint256 totalClaims,
        uint256 ratePerHeartbeat
    ) {
        return (
            address(this).balance,
            totalRewardsDistributed,
            totalClaimsProcessed,
            rewardPerHeartbeat
        );
    }
    
    // ============ Receive Function ============
    
    receive() external payable {
        emit TreasuryFunded(msg.sender, msg.value, address(this).balance);
    }
}

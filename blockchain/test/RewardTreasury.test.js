const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RewardTreasury", function () {
  let treasury;
  let owner;
  let rewardSigner;
  let user1;
  let user2;

  const INITIAL_FUNDING = ethers.parseEther("10");
  const REWARD_AMOUNT = 1000n; // 1000 wei

  beforeEach(async function () {
    [owner, rewardSigner, user1, user2] = await ethers.getSigners();

    const RewardTreasury = await ethers.getContractFactory("RewardTreasury");
    treasury = await RewardTreasury.deploy(rewardSigner.address, {
      value: INITIAL_FUNDING
    });
    await treasury.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await treasury.owner()).to.equal(owner.address);
    });

    it("Should set the correct reward signer", async function () {
      expect(await treasury.rewardSigner()).to.equal(rewardSigner.address);
    });

    it("Should have the initial funding", async function () {
      expect(await treasury.getTreasuryBalance()).to.equal(INITIAL_FUNDING);
    });

    it("Should have default reward rate of 1000 wei", async function () {
      expect(await treasury.rewardPerHeartbeat()).to.equal(1000n);
    });
  });

  describe("Funding", function () {
    it("Should accept ETH deposits", async function () {
      const depositAmount = ethers.parseEther("5");
      
      await expect(treasury.fundTreasury({ value: depositAmount }))
        .to.emit(treasury, "TreasuryFunded")
        .withArgs(owner.address, depositAmount, INITIAL_FUNDING + depositAmount);

      expect(await treasury.getTreasuryBalance()).to.equal(INITIAL_FUNDING + depositAmount);
    });

    it("Should reject zero deposits", async function () {
      await expect(treasury.fundTreasury({ value: 0 }))
        .to.be.revertedWith("RewardTreasury: must send ETH");
    });

    it("Should accept ETH via receive function", async function () {
      const sendAmount = ethers.parseEther("1");
      
      await owner.sendTransaction({
        to: await treasury.getAddress(),
        value: sendAmount
      });

      expect(await treasury.getTreasuryBalance()).to.equal(INITIAL_FUNDING + sendAmount);
    });
  });

  describe("Process Reward", function () {
    it("Should process reward successfully", async function () {
      const claimId = ethers.keccak256(ethers.toUtf8Bytes("claim1"));
      const initialBalance = await ethers.provider.getBalance(user1.address);

      await expect(
        treasury.connect(rewardSigner).processReward(user1.address, REWARD_AMOUNT, claimId)
      )
        .to.emit(treasury, "RewardClaimed")
        .withArgs(user1.address, REWARD_AMOUNT, claimId, await getBlockTimestamp());

      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance - initialBalance).to.equal(REWARD_AMOUNT);
    });

    it("Should update statistics after reward", async function () {
      const claimId = ethers.keccak256(ethers.toUtf8Bytes("claim1"));
      
      await treasury.connect(rewardSigner).processReward(user1.address, REWARD_AMOUNT, claimId);

      expect(await treasury.totalRewardsDistributed()).to.equal(REWARD_AMOUNT);
      expect(await treasury.totalClaimsProcessed()).to.equal(1n);
      expect(await treasury.getUserEarnings(user1.address)).to.equal(REWARD_AMOUNT);
    });

    it("Should prevent double claiming", async function () {
      const claimId = ethers.keccak256(ethers.toUtf8Bytes("claim1"));
      
      await treasury.connect(rewardSigner).processReward(user1.address, REWARD_AMOUNT, claimId);

      await expect(
        treasury.connect(rewardSigner).processReward(user1.address, REWARD_AMOUNT, claimId)
      ).to.be.revertedWith("RewardTreasury: reward already claimed");
    });

    it("Should reject non-signer calls", async function () {
      const claimId = ethers.keccak256(ethers.toUtf8Bytes("claim1"));
      
      await expect(
        treasury.connect(user1).processReward(user1.address, REWARD_AMOUNT, claimId)
      ).to.be.revertedWith("RewardTreasury: caller is not reward signer");
    });

    it("Should reject zero address recipient", async function () {
      const claimId = ethers.keccak256(ethers.toUtf8Bytes("claim1"));
      
      await expect(
        treasury.connect(rewardSigner).processReward(ethers.ZeroAddress, REWARD_AMOUNT, claimId)
      ).to.be.revertedWith("RewardTreasury: invalid recipient");
    });

    it("Should reject zero amount", async function () {
      const claimId = ethers.keccak256(ethers.toUtf8Bytes("claim1"));
      
      await expect(
        treasury.connect(rewardSigner).processReward(user1.address, 0, claimId)
      ).to.be.revertedWith("RewardTreasury: amount must be positive");
    });
  });

  describe("Batch Process Rewards", function () {
    it("Should process multiple rewards in batch", async function () {
      const recipients = [user1.address, user2.address];
      const amounts = [REWARD_AMOUNT, REWARD_AMOUNT * 2n];
      const claimIds = [
        ethers.keccak256(ethers.toUtf8Bytes("batch1")),
        ethers.keccak256(ethers.toUtf8Bytes("batch2"))
      ];

      const user1BalanceBefore = await ethers.provider.getBalance(user1.address);
      const user2BalanceBefore = await ethers.provider.getBalance(user2.address);

      await treasury.connect(rewardSigner).batchProcessRewards(recipients, amounts, claimIds);

      const user1BalanceAfter = await ethers.provider.getBalance(user1.address);
      const user2BalanceAfter = await ethers.provider.getBalance(user2.address);

      expect(user1BalanceAfter - user1BalanceBefore).to.equal(REWARD_AMOUNT);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(REWARD_AMOUNT * 2n);

      expect(await treasury.totalClaimsProcessed()).to.equal(2n);
    });

    it("Should reject array length mismatch", async function () {
      const recipients = [user1.address, user2.address];
      const amounts = [REWARD_AMOUNT]; // Mismatch
      const claimIds = [ethers.keccak256(ethers.toUtf8Bytes("batch1"))];

      await expect(
        treasury.connect(rewardSigner).batchProcessRewards(recipients, amounts, claimIds)
      ).to.be.revertedWith("RewardTreasury: array length mismatch");
    });

    it("Should reject empty batch", async function () {
      await expect(
        treasury.connect(rewardSigner).batchProcessRewards([], [], [])
      ).to.be.revertedWith("RewardTreasury: empty batch");
    });
  });

  describe("Admin Functions", function () {
    it("Should update reward signer", async function () {
      await expect(treasury.setRewardSigner(user1.address))
        .to.emit(treasury, "RewardSignerUpdated")
        .withArgs(rewardSigner.address, user1.address);

      expect(await treasury.rewardSigner()).to.equal(user1.address);
    });

    it("Should update reward rate", async function () {
      const newRate = 2000n;
      
      await expect(treasury.setRewardRate(newRate))
        .to.emit(treasury, "RewardRateUpdated")
        .withArgs(1000n, newRate);

      expect(await treasury.rewardPerHeartbeat()).to.equal(newRate);
    });

    it("Should allow emergency withdrawal", async function () {
      const withdrawAmount = ethers.parseEther("1");
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await treasury.emergencyWithdraw(owner.address, withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore + gasUsed).to.equal(withdrawAmount);
    });

    it("Should transfer ownership", async function () {
      await treasury.transferOwnership(user1.address);
      expect(await treasury.owner()).to.equal(user1.address);
    });

    it("Should reject admin calls from non-owner", async function () {
      await expect(treasury.connect(user1).setRewardSigner(user2.address))
        .to.be.revertedWith("RewardTreasury: caller is not owner");
    });
  });

  describe("View Functions", function () {
    it("Should return correct stats", async function () {
      const claimId = ethers.keccak256(ethers.toUtf8Bytes("claim1"));
      await treasury.connect(rewardSigner).processReward(user1.address, REWARD_AMOUNT, claimId);

      const [balance, totalDistributed, totalClaims, ratePerHeartbeat] = await treasury.getStats();

      expect(balance).to.equal(INITIAL_FUNDING - REWARD_AMOUNT);
      expect(totalDistributed).to.equal(REWARD_AMOUNT);
      expect(totalClaims).to.equal(1n);
      expect(ratePerHeartbeat).to.equal(1000n);
    });

    it("Should check if claim is processed", async function () {
      const claimId = ethers.keccak256(ethers.toUtf8Bytes("claim1"));
      
      expect(await treasury.isClaimProcessed(claimId)).to.be.false;
      
      await treasury.connect(rewardSigner).processReward(user1.address, REWARD_AMOUNT, claimId);
      
      expect(await treasury.isClaimProcessed(claimId)).to.be.true;
    });
  });

  // Helper function to get block timestamp
  async function getBlockTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
  }
});

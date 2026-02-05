const hre = require("hardhat");

async function main() {
  const contractAddress = "0x6F97e4B86084C66244C76bF1Ab632E8B82aB3637";
  
  console.log("🔍 Checking RewardTreasury contract...\n");
  console.log("Contract Address:", contractAddress);
  
  // Get the contract
  const RewardTreasury = await hre.ethers.getContractFactory("RewardTreasury");
  const treasury = RewardTreasury.attach(contractAddress);
  
  // Query contract state
  const owner = await treasury.owner();
  const rewardSigner = await treasury.rewardSigner();
  const treasuryBalance = await hre.ethers.provider.getBalance(contractAddress);
  const totalDistributed = await treasury.totalRewardsDistributed();
  const totalClaims = await treasury.totalClaimsProcessed();
  const rewardRate = await treasury.rewardPerHeartbeat();
  
  console.log("\n📊 Contract State:");
  console.log("   Owner:", owner);
  console.log("   Reward Signer (authorized to call processReward):", rewardSigner);
  console.log("   Treasury Balance:", hre.ethers.formatEther(treasuryBalance), "ETH");
  console.log("   Total Distributed:", hre.ethers.formatEther(totalDistributed), "ETH");
  console.log("   Total Claims:", totalClaims.toString());
  console.log("   Reward Per Heartbeat:", rewardRate.toString(), "wei");
  
  // Check current deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("\n🔐 Your Current Wallet:");
  console.log("   Address:", deployer.address);
  console.log("   Is Owner?:", deployer.address.toLowerCase() === owner.toLowerCase());
  console.log("   Is Reward Signer?:", deployer.address.toLowerCase() === rewardSigner.toLowerCase());
  
  if (deployer.address.toLowerCase() !== rewardSigner.toLowerCase()) {
    console.log("\n⚠️  WARNING: Your wallet is NOT the authorized rewardSigner!");
    console.log("   The backend needs to use the rewardSigner's private key to call processReward()");
  } else {
    console.log("\n✅ Your wallet IS the authorized rewardSigner");
    console.log("   Make sure SIGNER_PRIVATE_KEY is set on Render.com with your MetaMask private key");
  }
}

main()
  .then(() => process.exit(0))
  .catch(console.error);

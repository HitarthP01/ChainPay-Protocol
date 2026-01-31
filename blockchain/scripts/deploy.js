const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying Watch-to-Earn RewardTreasury Contract...\n");

  // Get deployer account
  const [deployer, rewardSigner] = await hre.ethers.getSigners();
  
  console.log("📋 Deployment Configuration:");
  console.log("   Network:", hre.network.name);
  console.log("   Deployer:", deployer.address);
  console.log("   Reward Signer:", rewardSigner.address);
  
  const deployerBalance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("   Deployer Balance:", hre.ethers.formatEther(deployerBalance), "ETH\n");

  // Initial treasury funding (100 ETH for testing)
  const initialFunding = hre.ethers.parseEther("100");
  
  // Deploy RewardTreasury contract
  console.log("📦 Deploying RewardTreasury...");
  const RewardTreasury = await hre.ethers.getContractFactory("RewardTreasury");
  const treasury = await RewardTreasury.deploy(rewardSigner.address, {
    value: initialFunding
  });
  
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  
  console.log("✅ RewardTreasury deployed to:", treasuryAddress);
  console.log("   Initial funding:", hre.ethers.formatEther(initialFunding), "ETH");
  
  // Get contract stats
  const stats = await treasury.getStats();
  console.log("\n📊 Contract Statistics:");
  console.log("   Treasury Balance:", hre.ethers.formatEther(stats[0]), "ETH");
  console.log("   Total Distributed:", hre.ethers.formatEther(stats[1]), "ETH");
  console.log("   Total Claims:", stats[2].toString());
  console.log("   Reward per Heartbeat:", stats[3].toString(), "wei");

  // Save deployment info for backend and frontend
  const deploymentInfo = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    contracts: {
      RewardTreasury: {
        address: treasuryAddress,
        deployer: deployer.address,
        rewardSigner: rewardSigner.address,
        initialFunding: initialFunding.toString()
      }
    },
    accounts: {
      deployer: deployer.address,
      rewardSigner: rewardSigner.address,
      // Include private key for local testing only (account index 1)
      rewardSignerPrivateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" // Hardhat account #1
    },
    deployedAt: new Date().toISOString()
  };

  // Create deployment directory if it doesn't exist
  const deploymentDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  // Save deployment info
  const deploymentPath = path.join(deploymentDir, "localhost.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("\n💾 Deployment info saved to:", deploymentPath);

  // Copy ABI for backend and frontend
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "RewardTreasury.sol", "RewardTreasury.json");
  
  console.log("\n🎉 Deployment Complete!");
  console.log("\n📝 Next Steps:");
  console.log("   1. Start the Go backend: cd ../backend && go run .");
  console.log("   2. Open the frontend: cd ../frontend && open index.html");
  console.log("   3. Watch ads and earn micro-rewards!");
  
  return { treasury, treasuryAddress, deploymentInfo };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

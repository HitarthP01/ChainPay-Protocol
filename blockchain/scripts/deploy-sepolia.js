const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying RewardTreasury to Sepolia Testnet...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("📋 Deployment Configuration:");
  console.log("   Network:", hre.network.name);
  console.log("   Chain ID:", hre.network.config.chainId);
  console.log("   Deployer:", deployer.address);
  
  const deployerBalance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("   Deployer Balance:", hre.ethers.formatEther(deployerBalance), "ETH\n");

  if (deployerBalance < hre.ethers.parseEther("0.01")) {
    console.error("❌ Insufficient balance! You need at least 0.01 Sepolia ETH");
    console.log("   Get free Sepolia ETH from: https://sepoliafaucet.com");
    process.exit(1);
  }

  // For testnet, deployer is also the reward signer (simpler setup)
  // In production, you'd use a separate hot wallet for signing rewards
  const rewardSigner = deployer.address;
  
  // Initial treasury funding - use small amount for testnet (0.01 ETH)
  const initialFunding = hre.ethers.parseEther("0.01");
  
  console.log("📦 Deploying RewardTreasury...");
  console.log("   Reward Signer:", rewardSigner);
  console.log("   Initial Funding:", hre.ethers.formatEther(initialFunding), "ETH");
  
  const RewardTreasury = await hre.ethers.getContractFactory("RewardTreasury");
  const treasury = await RewardTreasury.deploy(rewardSigner, {
    value: initialFunding
  });
  
  console.log("   Transaction hash:", treasury.deploymentTransaction().hash);
  console.log("   Waiting for confirmation...");
  
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  
  console.log("\n✅ RewardTreasury deployed to:", treasuryAddress);
  
  // Wait for a few blocks before verification
  console.log("   Waiting for block confirmations...");
  await treasury.deploymentTransaction().wait(5);
  
  // Get contract stats
  const stats = await treasury.getStats();
  console.log("\n📊 Contract Statistics:");
  console.log("   Treasury Balance:", hre.ethers.formatEther(stats[0]), "ETH");
  console.log("   Total Distributed:", hre.ethers.formatEther(stats[1]), "ETH");
  console.log("   Reward per Heartbeat:", stats[3].toString(), "wei");

  // Save deployment info
  const deploymentInfo = {
    network: "sepolia",
    chainId: 11155111,
    contracts: {
      RewardTreasury: {
        address: treasuryAddress,
        deployer: deployer.address,
        rewardSigner: rewardSigner,
        initialFunding: initialFunding.toString(),
        txHash: treasury.deploymentTransaction().hash
      }
    },
    rpcUrl: "https://rpc.sepolia.org",
    blockExplorer: `https://sepolia.etherscan.io/address/${treasuryAddress}`,
    deployedAt: new Date().toISOString()
  };

  // Save deployment info
  const deploymentDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const deploymentPath = path.join(deploymentDir, "sepolia.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("\n💾 Deployment info saved to:", deploymentPath);

  // Try to verify on Etherscan
  if (process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: treasuryAddress,
        constructorArguments: [rewardSigner],
      });
      console.log("✅ Contract verified on Etherscan!");
    } catch (error) {
      console.log("⚠️  Verification failed (may already be verified):", error.message);
    }
  }

  console.log("\n🎉 Deployment Complete!");
  console.log("\n📝 Next Steps:");
  console.log("   1. View your contract:", deploymentInfo.blockExplorer);
  console.log("   2. Update frontend/config.js with the contract address");
  console.log("   3. Update Render.com environment variables:");
  console.log("      - RPC_ENDPOINT:", deploymentInfo.rpcUrl);
  console.log("      - CONTRACT_ADDRESS:", treasuryAddress);
  console.log("      - SIGNER_PRIVATE_KEY: (your deployer key)");
  
  return { treasury, treasuryAddress, deploymentInfo };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

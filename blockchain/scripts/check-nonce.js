const hre = require("hardhat");

async function main() {
  const signerAddress = "0xdCE9d12ccAfbd6BBaa8425C921B2a27c43a9dF36";
  
  console.log("🔍 Checking nonce state for:", signerAddress);
  
  // Get current nonce (next nonce to use)
  const pendingNonce = await hre.ethers.provider.getTransactionCount(signerAddress, "pending");
  const confirmedNonce = await hre.ethers.provider.getTransactionCount(signerAddress, "latest");
  
  console.log("\n📊 Nonce Information:");
  console.log("   Confirmed Nonce (latest):", confirmedNonce);
  console.log("   Pending Nonce:", pendingNonce);
  
  if (pendingNonce > confirmedNonce) {
    console.log("   ⚠️  There are", pendingNonce - confirmedNonce, "pending transactions");
  } else {
    console.log("   ✅ No pending transactions");
  }
  
  // Get balance
  const balance = await hre.ethers.provider.getBalance(signerAddress);
  console.log("   Wallet Balance:", hre.ethers.formatEther(balance), "ETH");
  
  // Check contract
  const contractAddress = "0x6F97e4B86084C66244C76bF1Ab632E8B82aB3637";
  const contractBalance = await hre.ethers.provider.getBalance(contractAddress);
  console.log("   Treasury Balance:", hre.ethers.formatEther(contractBalance), "ETH");
}

main().catch(console.error);

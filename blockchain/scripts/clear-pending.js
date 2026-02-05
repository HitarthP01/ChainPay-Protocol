const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  
  console.log("🧹 Clearing stuck pending transactions for:", signer.address);
  
  // Get nonce info
  const pendingNonce = await hre.ethers.provider.getTransactionCount(signer.address, "pending");
  const confirmedNonce = await hre.ethers.provider.getTransactionCount(signer.address, "latest");
  
  console.log("   Confirmed nonce:", confirmedNonce);
  console.log("   Pending nonce:", pendingNonce);
  
  const stuckCount = pendingNonce - confirmedNonce;
  
  if (stuckCount === 0) {
    console.log("✅ No stuck transactions to clear!");
    return;
  }
  
  console.log(`\n⚠️  Found ${stuckCount} stuck transactions (nonces ${confirmedNonce} to ${pendingNonce - 1})`);
  console.log("   Sending replacement transactions with higher gas price...\n");
  
  // Get current gas price and multiply by 2 to ensure replacement
  const feeData = await hre.ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice * 2n;
  
  console.log("   Using gas price:", hre.ethers.formatUnits(gasPrice, "gwei"), "gwei");
  
  // Send replacement transactions for each stuck nonce
  for (let nonce = confirmedNonce; nonce < pendingNonce; nonce++) {
    console.log(`   Clearing nonce ${nonce}...`);
    
    try {
      // Send 0 ETH to ourselves with the stuck nonce
      const tx = await signer.sendTransaction({
        to: signer.address,
        value: 0,
        nonce: nonce,
        gasPrice: gasPrice,
        gasLimit: 21000
      });
      
      console.log(`   ✅ Sent replacement tx: ${tx.hash.slice(0, 20)}...`);
      
      // Wait for confirmation before moving to next
      await tx.wait(1);
      console.log(`   ✅ Nonce ${nonce} cleared!`);
    } catch (err) {
      console.log(`   ❌ Failed to clear nonce ${nonce}: ${err.message.slice(0, 50)}`);
    }
  }
  
  // Verify
  const newPendingNonce = await hre.ethers.provider.getTransactionCount(signer.address, "pending");
  const newConfirmedNonce = await hre.ethers.provider.getTransactionCount(signer.address, "latest");
  
  console.log("\n📊 Final state:");
  console.log("   Confirmed nonce:", newConfirmedNonce);
  console.log("   Pending nonce:", newPendingNonce);
  
  if (newPendingNonce === newConfirmedNonce) {
    console.log("✅ All stuck transactions cleared!");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

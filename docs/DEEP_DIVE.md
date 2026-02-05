# 🎓 Complete Project Deep-Dive: Watch-to-Earn Protocol

A comprehensive technical explanation of the ChainPay Watch-to-Earn system.

---

## 🎯 The Big Picture

### What Problem Are We Solving?

**Traditional Ad Model (Opaque):**
```
User watches ad → Ad Network → Publisher → ??? → User gets nothing
                     ↓
              (Black box - no proof of anything)
```

**Our Model (Transparent):**
```
User watches ad → Backend detects → Blockchain transaction → User's wallet
                                            ↓
                        (Public, verifiable, permanent record)
```

Every single micro-payment is recorded on-chain. Anyone can verify that "User X watched for Y seconds and received Z wei."

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │  wallet.js  │  │   app.js    │  │      index.html + CSS       │  │
│  │             │  │             │  │                             │  │
│  │ • Generate  │  │ • Heartbeat │  │ • Dashboard UI              │  │
│  │   keypair   │  │   every 5s  │  │ • Balance display           │  │
│  │ • Sign msgs │  │ • WebSocket │  │ • Transaction log           │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────────┘  │
└─────────┼────────────────┼──────────────────────────────────────────┘
          │                │
          │    HTTP/WebSocket (Port 8080)
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       GO BACKEND SERVER                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │  main.go    │  │blockchain.go│  │      Treasury Wallet        │  │
│  │             │  │             │  │                             │  │
│  │ • REST API  │  │ • Connect   │  │ • Private key from          │  │
│  │ • WebSocket │  │   to node   │  │   Hardhat Account #1        │  │
│  │ • Sessions  │  │ • Sign txns │  │ • Signs all reward txns     │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────────┘  │
└─────────┼────────────────┼──────────────────────────────────────────┘
          │                │
          │    JSON-RPC (Port 8545)
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    HARDHAT LOCAL BLOCKCHAIN                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                  RewardTreasury.sol Contract                    ││
│  │                                                                 ││
│  │  • Treasury balance (funded with 100 ETH)                       ││
│  │  • processReward(address user, uint256 amount)                  ││
│  │  • Tracks total distributed, user earnings                      ││
│  │  • Emits RewardClaimed events                                   ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Block 1 → Block 2 → Block 3 → Block 4 → ...                        │
│  (Each reward = new transaction in a block)                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📚 Layer 1: The Blockchain (Hardhat)

### What is Hardhat?

Hardhat is a **local Ethereum simulator**. It creates a fake blockchain on your computer that behaves exactly like the real Ethereum network, but:
- Transactions are instant (no waiting)
- Gas is free (test ETH)
- You control everything

### The Smart Contract Explained

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RewardTreasury {
    // WHO owns this contract (can add funds, pause, etc.)
    address public owner;
    
    // WHO can sign reward transactions (backend server)
    address public rewardSigner;
    
    // HOW MUCH has been given out total
    uint256 public totalRewardsDistributed;
    
    // HOW MANY individual payments made
    uint256 public totalClaimsProcessed;
    
    // TRACKING per-user: how much has each address earned?
    mapping(address => uint256) public userTotalEarnings;
    
    // PREVENT double-spending: track which claims are processed
    mapping(bytes32 => bool) public claimedRewards;
    
    // EVENT: Logged permanently on blockchain when payment happens
    event RewardClaimed(
        address indexed recipient,  // WHO received
        uint256 amount,             // HOW MUCH (in wei)
        bytes32 indexed claimId,    // UNIQUE identifier
        uint256 timestamp           // WHEN
    );
    
    // MAIN FUNCTION: Send reward to user
    function processReward(
        address payable recipient,
        uint256 amount,
        bytes32 claimId
    ) external onlyRewardSigner {
        require(!claimedRewards[claimId], "Already claimed");
        
        claimedRewards[claimId] = true;
        totalRewardsDistributed += amount;
        totalClaimsProcessed += 1;
        userTotalEarnings[recipient] += amount;
        
        // Actually send the ETH
        recipient.call{value: amount}("");
        
        emit RewardClaimed(recipient, amount, claimId, block.timestamp);
    }
}
```

### Key Contract Features

| Feature | Purpose |
|---------|---------|
| `owner` | Admin who can withdraw/configure |
| `rewardSigner` | Backend's address - only it can trigger rewards |
| `claimedRewards` | Prevents same reward from being claimed twice |
| `userTotalEarnings` | Track lifetime earnings per user |
| `RewardClaimed` event | Permanent proof of every payment |

### What is Wei?

```
1 ETH = 1,000,000,000,000,000,000 wei (10^18)
1 ETH = 1,000,000,000 gwei (10^9)
```

**Why use Wei?**
- Traditional money: Smallest unit = $0.01 (1 cent)
- Ethereum: Smallest unit = 0.000000000000000001 ETH

This allows **true micro-payments**. We pay 1000 wei per heartbeat:
```
1000 wei = 0.000000000000001 ETH
         ≈ $0.000000000000003 (at $3000/ETH)
```

In real systems, you'd use larger amounts, but this demonstrates the concept!

---

## 📚 Layer 2: The Go Backend

### Why Go?

Go is chosen for blockchain backends because:
- **Fast**: Compiled language, handles thousands of requests
- **go-ethereum**: Official Ethereum library maintained by the Ethereum Foundation
- **Concurrency**: Goroutines handle multiple users simultaneously

### Key Components

#### 1. Connecting to the Blockchain

```go
// This creates a "phone line" to talk to Hardhat
client, err := ethclient.Dial("http://127.0.0.1:8545")

// Get the current chain ID (1337 for Hardhat)
chainID, err := client.ChainID(context.Background())
```

#### 2. Loading the Treasury Wallet

```go
// This private key controls the reward treasury!
// In production, this would be in a secure vault (HSM, AWS KMS, etc.)
privateKey, err := crypto.HexToECDSA(
    "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
)

// Derive the public address from private key
publicKey := privateKey.Public()
publicKeyECDSA := publicKey.(*ecdsa.PublicKey)
signerAddress := crypto.PubkeyToAddress(*publicKeyECDSA)
// Result: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

#### 3. Creating a Signed Transaction

```go
// Build the transaction
tx := types.NewTransaction(
    nonce,           // Prevents replay attacks
    toAddress,       // User's ephemeral wallet
    amount,          // 1000 wei
    gasLimit,        // Max computation allowed
    gasPrice,        // Fee per unit of gas
    data,            // Contract function call
)

// Sign it with treasury's private key
signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKey)

// Broadcast to blockchain
err = client.SendTransaction(context.Background(), signedTx)
// Now it's permanent! Anyone can verify this happened.
```

### What is a Nonce?

```
Transaction 1: nonce = 0  ✅ Accepted
Transaction 2: nonce = 1  ✅ Accepted
Transaction 3: nonce = 1  ❌ Rejected (already used!)
Transaction 4: nonce = 2  ✅ Accepted
```

The nonce prevents **replay attacks** - someone can't take your signed transaction and submit it multiple times.

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Server health check |
| `/api/balance/{address}` | GET | Check any wallet's balance |
| `/api/heartbeat` | POST | "I'm still watching!" - triggers reward |
| `/api/stats` | GET | Treasury and server statistics |
| `/api/treasury` | GET | Contract address, balance, rates |
| `/ws` | WebSocket | Real-time updates pushed to browser |

### WebSocket Messages

**Client → Server:**
```json
{ "type": "register", "wallet_address": "0x..." }
{ "type": "heartbeat", "wallet_address": "0x...", "timestamp": 123456789 }
{ "type": "ping" }
```

**Server → Client:**
```json
{ "type": "connected", "config": { "reward_per_heartbeat": 1000 } }
{ "type": "reward", "success": true, "reward_wei": "1000", "tx_hash": "0x..." }
{ "type": "block", "number": 123, "hash": "0x...", "timestamp": 123456789 }
{ "type": "pong" }
```

---

## 📚 Layer 3: The Frontend

### Ephemeral Wallet Generation

```javascript
// Using ethers.js to create a REAL Ethereum wallet in your browser!

generate() {
    // 1. Generate random wallet (uses crypto.getRandomValues internally)
    this.wallet = ethers.Wallet.createRandom();
    
    // 2. Extract address and private key
    this.address = this.wallet.address;      // 0x742d35Cc6634C0532925a3b844Bc9e7595f...
    this.privateKey = this.wallet.privateKey; // 0xa1b2c3d4e5f6...
    
    return {
        address: this.address,
        privateKeyTruncated: this.privateKey.slice(0, 10) + '...'
    };
}
```

### How Wallet Generation Works

```
1. Generate 32 random bytes (256 bits of entropy)
   → [a1, b2, c3, d4, e5, f6, ...]

2. This becomes the private key
   → 0xa1b2c3d4e5f6...

3. Apply Elliptic Curve multiplication (secp256k1)
   → Public Key (64 bytes)

4. Keccak256 hash of public key
   → 32 bytes

5. Take last 20 bytes
   → Ethereum Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f...
```

### Why "Ephemeral"?

- **Created**: Fresh wallet generated when you click "Generate"
- **Stored**: Only in browser memory (and optionally localStorage)
- **Destroyed**: Gone when you close the tab (unless saved)

This means:
- ✅ No registration required
- ✅ No KYC (Know Your Customer)
- ✅ Instant onboarding
- ✅ User controls their own keys
- ⚠️ Lose the key = lose the funds

### The Heartbeat Mechanism

```javascript
startWatching() {
    this.isWatching = true;
    
    // Every 5 seconds, tell the server "I'm still here!"
    this.heartbeatTimer = setInterval(() => {
        
        // Send via WebSocket for real-time response
        this.websocket.send(JSON.stringify({
            type: 'heartbeat',
            wallet_address: this.wallet.getAddress(),
            timestamp: Date.now()
        }));
        
    }, 5000); // Every 5 seconds
}

// Handle the reward confirmation
handleRewardMessage(data) {
    if (data.success) {
        this.heartbeatCount++;
        this.sessionEarnings += BigInt(data.reward_wei);
        
        // Update UI
        this.elements.heartbeatCount.textContent = this.heartbeatCount;
        this.elements.sessionEarnings.textContent = this.sessionEarnings.toString();
        
        // Log the transaction hash (proof of payment!)
        this.log('reward', `💰 Earned ${data.reward_wei} wei! TX: ${data.tx_hash}`);
    }
}
```

---

## 🔄 Complete Flow: What Happens When You Click "Start Watching"

```
Second 0: User clicks "Start Watching"
          └→ JavaScript starts setInterval (5000ms)
          └→ Ad display becomes active

Second 5: First heartbeat fires
          └→ WebSocket sends: {type: "heartbeat", wallet_address: "0xABC..."}
          └→ Go backend receives message
          └→ Generates unique claimId using keccak256 hash
          └→ Loads treasury private key
          └→ Calls contract: processReward(0xABC, 1000 wei, claimId)
          └→ Signs transaction with private key
          └→ Sends to Hardhat node via JSON-RPC
          └→ Hardhat mines it into Block #X
          └→ Contract emits RewardClaimed event
          └→ Returns txHash to backend
          └→ Backend sends WebSocket message: {type: "reward", tx_hash: "0x..."}
          └→ Frontend updates balance display
          └→ Transaction appears in log

Second 10: Second heartbeat fires
           └→ Same process, user now has 2000 wei

Second 15: Third heartbeat
           └→ User now has 3000 wei

... and so on until user clicks "Stop"
```

---

## 🔐 Security Concepts Demonstrated

### 1. Private Key Security

```
Private Key → Can spend all funds (KEEP SECRET!)
Public Address → Can only receive funds (SAFE TO SHARE)

The backend's treasury key is the critical secret.
User's ephemeral keys stay in their browser.
```

### 2. Cryptographic Signatures

```
Transaction = {to: "0xABC", value: 1000, nonce: 5}
                    ↓
            Sign with Private Key
                    ↓
Signature = 0x1234567890abcdef...

Anyone can verify:
✅ This transaction was authorized by the treasury
✅ It hasn't been modified (integrity)
✅ It can only be used once (nonce)
❌ Cannot be forged without private key
```

### 3. Immutability

```
Block 100: Contains your reward transaction (hash: 0xAAA)
              ↓
Block 101: References Block 100's hash in its header
              ↓
Block 102: References Block 101's hash
              ↓
Block 103: References Block 102's hash
              ...

To change Block 100:
1. Recalculate its hash → Now 0xBBB instead of 0xAAA
2. Block 101's reference is now invalid
3. Must recalculate Block 101 → New hash
4. Block 102's reference is now invalid
5. Must recalculate ALL subsequent blocks!

This becomes exponentially harder over time.
```

### 4. Claim ID Uniqueness

```go
// Generate unique claim ID to prevent double-claiming
claimID := crypto.Keccak256Hash(
    recipientAddr.Bytes(),           // Who
    amount.Bytes(),                   // How much
    big.NewInt(time.Now().UnixNano()).Bytes(),  // When (nanosecond precision)
)
// Result: 0x7d8f3a2b1c... (unique 32-byte hash)
```

---

## 📊 Blockchain vs Traditional Database

| Aspect | Traditional Database | Blockchain |
|--------|---------------------|------------|
| **Control** | Company owns server | Distributed network |
| **Modifications** | Can edit/delete anytime | Immutable after confirmation |
| **Trust Model** | "Trust us, we paid you" | "Verify the cryptographic proof" |
| **Failure Mode** | Single point of failure | Decentralized redundancy |
| **Auditing** | Requires special access | Anyone can verify |
| **Transparency** | Opaque by default | Transparent by default |
| **Speed** | Milliseconds | Seconds to minutes |
| **Cost** | Fixed infrastructure | Per-transaction fees (gas) |

---

## 🧪 Experiments to Try

### 1. Watch a Transaction Get Mined

Look at Terminal 1 (Hardhat) when you earn a reward:
```
eth_sendRawTransaction  ← Your reward transaction submitted
  Contract call:       RewardTreasury.processReward(...)
eth_getTransactionReceipt  ← Checking confirmation status
  Transaction: 0x123... Status: Success
```

### 2. Check Balance Directly via Console

```powershell
cd blockchain
npx hardhat console --network localhost
```

Then in the console:
```javascript
// Check a wallet's balance
const addr = "0xYOUR_EPHEMERAL_WALLET_ADDRESS";
const balance = await ethers.provider.getBalance(addr);
console.log("Balance:", ethers.formatEther(balance), "ETH");
console.log("Balance:", balance.toString(), "wei");
```

### 3. Query All Reward Events

```javascript
// Get the deployed contract
const treasuryAddr = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const Treasury = await ethers.getContractFactory("RewardTreasury");
const treasury = Treasury.attach(treasuryAddr);

// Query all RewardClaimed events
const events = await treasury.queryFilter("RewardClaimed");
console.log(`Found ${events.length} reward payments:`);

events.forEach((event, i) => {
    console.log(`\n--- Reward #${i + 1} ---`);
    console.log("Recipient:", event.args.recipient);
    console.log("Amount:", event.args.amount.toString(), "wei");
    console.log("Block:", event.blockNumber);
});
```

### 4. Check Treasury Statistics

```javascript
const stats = await treasury.getStats();
console.log("Treasury Balance:", ethers.formatEther(stats[0]), "ETH");
console.log("Total Distributed:", ethers.formatEther(stats[1]), "ETH");
console.log("Total Claims:", stats[2].toString());
console.log("Rate per Heartbeat:", stats[3].toString(), "wei");
```

---

## 🚀 Production Considerations

If deploying this for real users:

### 1. Blockchain Choice
| Network | Type | Cost per TX | Confirmation Time |
|---------|------|-------------|-------------------|
| Ethereum Mainnet | L1 | $1-50 | 12 seconds |
| Polygon | L2 | $0.001-0.01 | 2 seconds |
| Arbitrum | L2 | $0.01-0.10 | Instant |
| Base | L2 | $0.001-0.01 | 2 seconds |

**Recommendation**: Use an L2 like Polygon or Base for micro-payments.

### 2. Larger Rewards
```
---

## 🌐 Production Deployment

This project is deployed using free hosting services, demonstrating a complete production-ready setup.

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PRODUCTION DEPLOYMENT                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   GitHub Pages          Render.com            Sepolia Testnet        │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│   │   Frontend   │────▶│   Backend    │────▶│   Contract   │        │
│   │   (Static)   │     │   (Go API)   │     │  (Solidity)  │        │
│   └──────────────┘     └──────────────┘     └──────────────┘        │
│         │                     │                    │                 │
│    index.html            WebSocket             processReward()       │
│    app.js                 REST API              getBalance()         │
│    config.js              go-ethereum           getStats()           │
│                                                                      │
│   URL:                   URL:                   Address:             │
│   hitarthp01.github.io   chainpay-protocol     0x6F97e4B86084C...   │
│   /ChainPay-Protocol     .onrender.com                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Live URLs

| Component | Service | URL |
|-----------|---------|-----|
| Frontend | GitHub Pages | [hitarthp01.github.io/ChainPay-Protocol](https://hitarthp01.github.io/ChainPay-Protocol/frontend/) |
| Backend | Render.com | [chainpay-protocol.onrender.com](https://chainpay-protocol.onrender.com/api/health) |
| Contract | Sepolia | [Etherscan](https://sepolia.etherscan.io/address/0x6F97e4B86084C66244C76bF1Ab632E8B82aB3637) |

### Frontend Configuration (config.js)

The frontend auto-detects its environment:

```javascript
const ChainPayConfig = {
    // Auto-detect local vs deployed
    isLocal: window.location.hostname === 'localhost',
    
    // Production backend URL
    deployedBackendUrl: 'https://chainpay-protocol.onrender.com',
    
    // Contract on Sepolia
    contracts: {
        sepolia: {
            chainId: 11155111,
            rewardTreasury: '0x6F97e4B86084C66244C76bF1Ab632E8B82aB3637'
        }
    },
    
    // Demo mode when backend unavailable
    get demoMode() {
        return !this.backendUrl;
    }
};
```

### Backend Environment Variables

The Go backend reads configuration from environment variables:

```bash
RPC_ENDPOINT=https://eth-sepolia.g.alchemy.com/v2/your-key
CONTRACT_ADDRESS=0x6F97e4B86084C66244C76bF1Ab632E8B82aB3637
SIGNER_PRIVATE_KEY=your-private-key  # Wallet that signs reward transactions
HTTP_PORT=8080
```

### Demo Mode

When the frontend cannot connect to the backend (e.g., backend sleeping on free tier), it automatically switches to **Demo Mode**:

- Generates real Ethereum key pairs (ephemeral wallets)
- Simulates heartbeats and rewards locally
- Shows simulated transaction hashes
- Displays "🎮 Demo Mode" indicator

This ensures the app is always functional for demonstrations, even without a running backend.

---

## 🚀 Scaling to Production

### 1. Meaningful Rewards
```
Demo:    1,000 wei = $0.000000000003
Real:    100,000,000,000,000 wei = 0.0001 ETH ≈ $0.30
```

### 2. Treasury Security
- **Never** hardcode private keys
- Use Hardware Security Module (HSM)
- Or cloud KMS (AWS KMS, Azure Key Vault)
- Multi-signature for large withdrawals

### 3. Anti-Fraud Measures
- Proof of attention (eye tracking APIs)
- CAPTCHA challenges
- Rate limiting per IP/wallet
- Machine learning for bot detection

### 4. User Withdrawals
- Let users claim to external wallets
- Minimum withdrawal thresholds
- Gas fee considerations

---

## 📖 Glossary

| Term | Definition |
|------|------------|
| **Wei** | Smallest unit of ETH (10^-18 ETH) |
| **Gas** | Unit measuring computational work |
| **Nonce** | Transaction counter preventing replays |
| **Private Key** | Secret 256-bit number controlling a wallet |
| **Address** | Public identifier derived from private key |
| **Smart Contract** | Code deployed on blockchain |
| **Transaction** | Signed instruction to transfer value or call contract |
| **Block** | Bundle of transactions mined together |
| **Event** | Log emitted by contract, stored permanently |
| **ABI** | Contract interface definition (like an API spec) |

---

## 🔗 Resources

- [Ethereum Documentation](https://ethereum.org/developers)
- [Solidity Language](https://docs.soliditylang.org)
- [Hardhat Documentation](https://hardhat.org/docs)
- [go-ethereum (Geth)](https://geth.ethereum.org)
- [ethers.js Documentation](https://docs.ethers.org)

---

*Built with ❤️ for the decentralized future*

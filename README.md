# ChainPay Protocol - Watch-to-Earn Prototype

A decentralized "Watch-to-Earn" system that demonstrates real-time micro-payouts to website visitors using a private Ethereum-compatible blockchain.

## 🎯 Overview

Traditional ad-revenue models are opaque. ChainPay creates transparency by settling rewards **on-chain**, proving that for every ad-interaction, a specific micro-unit of value is transferred to the user.

### Key Features

- **Real Blockchain Payments**: Every reward is a real Ethereum transaction
- **Micro-Granularity**: Rewards denominated in Wei (10⁻¹⁸ ETH)
- **Ephemeral Wallets**: Browser-generated wallets for instant participation
- **Live Updates**: WebSocket-powered real-time balance tracking
- **Full Transparency**: All transactions verifiable on-chain

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (JavaScript)                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Ephemeral Wallet│  │  Ad Heartbeat   │  │  Live Balance   │  │
│  │   Generation    │  │    Tracker      │  │    Display      │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼────────────────────┼────────────────────┼───────────┘
            │                    │                    │
            │    HTTP/WebSocket  │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       BACKEND (Go)                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Reward Treasury │  │  Transaction    │  │     Block       │  │
│  │    Manager      │  │    Signer       │  │    Monitor      │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼────────────────────┼────────────────────┼───────────┘
            │                    │                    │
            │       go-ethereum  │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN (Hardhat Node)                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   RewardTreasury.sol                        ││
│  │  • processReward()    • batchProcessRewards()               ││
│  │  • fundTreasury()     • getUserEarnings()                   ││
│  │  • getStats()         • emergencyWithdraw()                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Go** 1.21+
- **Git**

### 1. Clone and Setup Blockchain

```bash
# Navigate to blockchain directory
cd blockchain

# Install dependencies
npm install

# Start local Hardhat node (keep this running)
npm run node
```

You should see accounts with 10000 ETH each. **Keep this terminal open!**

### 2. Deploy Smart Contract

In a new terminal:

```bash
cd blockchain

# Deploy the RewardTreasury contract
npm run deploy
```

This will:
- Deploy RewardTreasury with 100 ETH initial funding
- Save deployment info to `deployments/localhost.json`
- Configure the reward signer (Hardhat account #1)

### 3. Start Go Backend

```bash
cd backend

# Download dependencies
go mod tidy

# Run the server
go run .
```

The backend will:
- Connect to the local Hardhat node
- Load the deployed contract address
- Start HTTP server on port 8080
- Open WebSocket for real-time updates

### 4. Open Frontend

Open `frontend/index.html` in your browser (or use a local server):

```bash
# Using Python
cd frontend
python -m http.server 3000

# Or using Node.js
npx serve frontend -l 3000
```

Then visit: `http://localhost:3000`

## 📖 How It Works

### The "Micro" Mechanic

1. **Visitor arrives** → Frontend generates an ephemeral wallet (private key never leaves browser)
2. **Visitor watches ad** → Frontend sends heartbeat every 5 seconds
3. **Backend processes heartbeat** → Signs and submits transaction to blockchain
4. **Smart contract transfers reward** → 1000 wei per heartbeat
5. **Frontend updates balance** → Live balance fetched from blockchain

### Reward Flow

```
User Watches Ad (5 sec)
        │
        ▼
Frontend sends heartbeat ──► Backend receives heartbeat
                                      │
                                      ▼
                            Backend creates transaction
                            (recipient, 1000 wei, claimId)
                                      │
                                      ▼
                            Backend signs with private key
                                      │
                                      ▼
                            Submits to Hardhat node
                                      │
                                      ▼
                            RewardTreasury.processReward()
                                      │
                                      ▼
                            Wei transferred to user wallet
                                      │
                                      ▼
                            Event emitted: RewardClaimed
                                      │
                                      ▼
                            Frontend receives confirmation
                                      │
                                      ▼
                            Balance display updated
```

## 📁 Project Structure

```
ChainPay-Protocol/
├── blockchain/                 # Hardhat project
│   ├── contracts/
│   │   └── RewardTreasury.sol  # Main smart contract
│   ├── scripts/
│   │   └── deploy.js           # Deployment script
│   ├── test/
│   │   └── RewardTreasury.test.js
│   ├── deployments/
│   │   └── localhost.json      # Deployment info (generated)
│   ├── hardhat.config.js
│   └── package.json
│
├── backend/                    # Go backend
│   ├── main.go                 # HTTP server & WebSocket handler
│   ├── blockchain.go           # go-ethereum client
│   └── go.mod
│
├── frontend/                   # Web interface
│   ├── index.html              # Main HTML
│   ├── styles.css              # Styling
│   ├── wallet.js               # Ephemeral wallet (ethers.js)
│   └── app.js                  # Main application logic
│
└── README.md
```

## 🔧 API Reference

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server health check |
| `/api/stats` | GET | Treasury and server statistics |
| `/api/balance/{address}` | GET | Get wallet balance |
| `/api/heartbeat` | POST | Submit ad-view heartbeat |
| `/api/treasury` | GET | Treasury contract info |
| `/api/block/latest` | GET | Latest block info |
| `/api/user/{address}/earnings` | GET | User's total earnings |

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

## 🧪 Testing

### Smart Contract Tests

```bash
cd blockchain
npm test
```

### Manual Testing

1. Generate a wallet in the frontend
2. Click "Start Watching"
3. Observe heartbeats and reward transactions
4. Check the transaction log for TX hashes
5. Verify balances update in real-time

## ⚙️ Configuration

### Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_ENDPOINT` | `http://127.0.0.1:8545` | Blockchain RPC URL |
| `CONTRACT_ADDRESS` | Auto-detected | RewardTreasury contract address |
| `SIGNER_PRIVATE_KEY` | Hardhat #1 | Private key for signing rewards |
| `HTTP_PORT` | `8080` | Backend HTTP port |

### Frontend Configuration

Edit `app.js` constructor:

```javascript
this.config = {
    backendUrl: 'http://localhost:8080',
    wsUrl: 'ws://localhost:8080/ws',
    heartbeatInterval: 5000,  // 5 seconds
    balanceRefreshInterval: 10000
};
```

## 🔐 Security Notes

⚠️ **This is a prototype for demonstration purposes!**

- Ephemeral wallets are stored in browser memory only
- Private keys are exposed in development configuration
- No rate limiting or fraud prevention implemented
- Smart contract not audited

For production:
- Use proper key management (HSM, KMS)
- Implement signature verification for heartbeats
- Add rate limiting and anti-fraud measures
- Conduct security audits

## 📊 Wei and Ether Units

| Unit | Wei Value | Ether Value |
|------|-----------|-------------|
| Wei | 1 | 0.000000000000000001 |
| Gwei | 10⁹ | 0.000000001 |
| Ether | 10¹⁸ | 1 |

Default reward: **1000 wei** per heartbeat (every 5 seconds)
- 12 heartbeats/minute = 12,000 wei/minute
- 720 heartbeats/hour = 720,000 wei/hour
- ~0.00000000072 ETH/hour

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

---

Built with ❤️ for the decentralized future

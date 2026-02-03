/**
 * ChainPay Configuration
 * Automatically detects environment and uses appropriate settings
 */

const ChainPayConfig = {
    // Detect if running locally or deployed
    isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    
    // Backend URLs
    get backendUrl() {
        if (this.isLocal) {
            return 'http://localhost:8080';
        }
        // For GitHub Pages demo, we'll run in demo mode (no backend)
        return null;
    },
    
    get wsUrl() {
        if (this.isLocal) {
            return 'ws://localhost:8080/ws';
        }
        return null;
    },
    
    // Smart Contract (update after deploying to testnet)
    contracts: {
        // Sepolia Testnet
        sepolia: {
            chainId: 11155111,
            rpcUrl: 'https://rpc.sepolia.org',
            rewardTreasury: '' // Add after deploying: npx hardhat run scripts/deploy.js --network sepolia
        },
        // Local Hardhat
        localhost: {
            chainId: 1337,
            rpcUrl: 'http://127.0.0.1:8545',
            rewardTreasury: '' // Loaded from deployments/localhost.json
        }
    },
    
    // Demo mode for showcasing without backend
    demoMode: true, // Set to false when you have a deployed backend
    
    // Heartbeat settings
    heartbeatInterval: 5000,
    balanceRefreshInterval: 10000,
    rewardPerHeartbeat: 1000 // Wei per heartbeat in demo mode
};

// Export for use
window.ChainPayConfig = ChainPayConfig;

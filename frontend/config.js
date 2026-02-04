/**
 * ChainPay Configuration
 * Automatically detects environment and uses appropriate settings
 */

const ChainPayConfig = {
    // Detect if running locally or deployed
    isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    
    // ⚠️ UPDATE THIS after deploying your backend to Render.com!
    // Example: 'https://chainpay-backend.onrender.com'
    deployedBackendUrl: 'https://chainpay-protocol.onrender.com',  // Set to your Render URL when deployed
    
    // Backend URLs
    get backendUrl() {
        if (this.isLocal) {
            return 'http://localhost:8080';
        }
        // Use deployed backend if configured, otherwise demo mode
        return this.deployedBackendUrl;
    },
    
    get wsUrl() {
        if (this.isLocal) {
            return 'ws://localhost:8080/ws';
        }
        if (this.deployedBackendUrl) {
            // Convert https to wss for WebSocket
            return this.deployedBackendUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws';
        }
        return null;
    },
    
    // Smart Contract (update after deploying to testnet)
    contracts: {
        // Sepolia Testnet
        sepolia: {
            chainId: 11155111,
            rpcUrl: 'https://rpc.sepolia.org',
            rewardTreasury: '0x6F97e4B86084C66244C76bF1Ab632E8B82aB3637'
        },
        // Local Hardhat
        localhost: {
            chainId: 1337,
            rpcUrl: 'http://127.0.0.1:8545',
            rewardTreasury: '' // Loaded from deployments/localhost.json
        }
    },
    
    // Demo mode - enabled when no backend URL is configured
    get demoMode() {
        return !this.backendUrl;
    },
    
    // Heartbeat settings
    heartbeatInterval: 5000,
    balanceRefreshInterval: 10000,
    rewardPerHeartbeat: 1000 // Wei per heartbeat in demo mode
};

// Export for use
window.ChainPayConfig = ChainPayConfig;

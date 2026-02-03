/**
 * ChainPay - Watch-to-Earn Main Application
 * Handles ad viewing, heartbeats, and blockchain interactions
 */

class ChainPayApp {
    constructor() {
        // Use external config if available, otherwise defaults
        const externalConfig = window.ChainPayConfig || {};
        
        // Configuration - supports both local dev and deployed demo mode
        this.config = {
            backendUrl: externalConfig.backendUrl || 'http://localhost:8080',
            wsUrl: externalConfig.wsUrl || 'ws://localhost:8080/ws',
            heartbeatInterval: externalConfig.heartbeatInterval || 5000,
            balanceRefreshInterval: externalConfig.balanceRefreshInterval || 10000,
            reconnectDelay: 3000,
            demoMode: externalConfig.demoMode || !externalConfig.backendUrl
        };

        // State
        this.wallet = new EphemeralWallet();
        this.websocket = null;
        this.isWatching = false;
        this.heartbeatTimer = null;
        this.balanceTimer = null;
        this.watchStartTime = null;
        this.heartbeatCount = 0;
        this.sessionEarnings = BigInt(0);
        this.rewardPerHeartbeat = BigInt(externalConfig.rewardPerHeartbeat || 1000);
        this.currentAdIndex = 0;
        
        // Demo mode state
        this.demoBalance = BigInt(0);

        // Sample ads for demo
        this.sampleAds = [
            { title: "🚀 DeFi Revolution", subtitle: "Earn up to 20% APY", gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
            { title: "🎮 GameFi Paradise", subtitle: "Play, Earn, Repeat!", gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
            { title: "🌐 Web3 Future", subtitle: "Own Your Digital Life", gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)" },
            { title: "💎 NFT Marketplace", subtitle: "Collect Rare Treasures", gradient: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)" },
            { title: "🔐 Secure Wallet", subtitle: "Your Keys, Your Crypto", gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)" }
        ];

        // DOM Elements
        this.elements = {};
        
        // Initialize
        this.init();
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('🚀 Initializing ChainPay Watch-to-Earn...');
        
        this.cacheElements();
        this.bindEvents();
        this.connectWebSocket();
        this.startBackgroundTasks();

        this.log('info', 'Application initialized. Generate a wallet to start earning!');
    }

    /**
     * Cache DOM elements for performance
     */
    cacheElements() {
        this.elements = {
            // Status
            blockchainStatus: document.getElementById('blockchainStatus'),
            blockchainStatusText: document.getElementById('blockchainStatusText'),
            wsStatus: document.getElementById('wsStatus'),
            wsStatusText: document.getElementById('wsStatusText'),
            currentBlock: document.getElementById('currentBlock'),

            // Wallet
            walletAddress: document.getElementById('walletAddress'),
            balanceEth: document.getElementById('balanceEth'),
            balanceWei: document.getElementById('balanceWei'),
            generateWalletBtn: document.getElementById('generateWalletBtn'),
            refreshBalanceBtn: document.getElementById('refreshBalanceBtn'),
            copyAddressBtn: document.getElementById('copyAddressBtn'),

            // Ad Viewer
            adDisplay: document.getElementById('adDisplay'),
            adProgress: document.getElementById('adProgress'),
            adTimer: document.getElementById('adTimer'),
            startWatchingBtn: document.getElementById('startWatchingBtn'),
            stopWatchingBtn: document.getElementById('stopWatchingBtn'),
            heartbeatCount: document.getElementById('heartbeatCount'),
            sessionEarnings: document.getElementById('sessionEarnings'),
            rewardRate: document.getElementById('rewardRate'),

            // Treasury
            treasuryBalance: document.getElementById('treasuryBalance'),
            totalDistributed: document.getElementById('totalDistributed'),
            totalClaims: document.getElementById('totalClaims'),
            activeConnections: document.getElementById('activeConnections'),
            contractAddress: document.getElementById('contractAddress'),

            // Log
            transactionLog: document.getElementById('transactionLog'),
            clearLogBtn: document.getElementById('clearLogBtn'),
            autoScrollLog: document.getElementById('autoScrollLog'),

            // Modal
            techModal: document.getElementById('techModal'),
            showTechDetails: document.getElementById('showTechDetails'),
            closeTechModal: document.getElementById('closeTechModal')
        };
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Wallet
        this.elements.generateWalletBtn.addEventListener('click', () => this.generateWallet());
        this.elements.refreshBalanceBtn.addEventListener('click', () => this.refreshBalance());
        this.elements.copyAddressBtn.addEventListener('click', () => this.copyAddress());

        // Ad Controls
        this.elements.startWatchingBtn.addEventListener('click', () => this.startWatching());
        this.elements.stopWatchingBtn.addEventListener('click', () => this.stopWatching());

        // Log
        this.elements.clearLogBtn.addEventListener('click', () => this.clearLog());

        // Modal
        this.elements.showTechDetails.addEventListener('click', (e) => {
            e.preventDefault();
            this.elements.techModal.classList.add('active');
        });
        this.elements.closeTechModal.addEventListener('click', () => {
            this.elements.techModal.classList.remove('active');
        });
        this.elements.techModal.addEventListener('click', (e) => {
            if (e.target === this.elements.techModal) {
                this.elements.techModal.classList.remove('active');
            }
        });
    }

    /**
     * Connect to WebSocket server (or enable demo mode)
     */
    connectWebSocket() {
        // Demo mode - simulate connection for GitHub Pages deployment
        if (this.config.demoMode) {
            console.log('🎮 Running in DEMO MODE (no backend required)');
            this.updateWsStatus('demo');
            this.updateBlockchainStatus('demo');
            this.log('info', '🎮 DEMO MODE: Simulating blockchain interactions locally');
            this.log('info', 'In production, this connects to a real Go backend + smart contract');
            
            // Simulate block updates in demo mode
            this.startDemoBlockUpdates();
            return;
        }
        
        console.log('🔌 Connecting to WebSocket...');
        this.updateWsStatus('connecting');

        try {
            this.websocket = new WebSocket(this.config.wsUrl);

            this.websocket.onopen = () => {
                console.log('✅ WebSocket connected');
                this.updateWsStatus('connected');
                this.log('success', 'Connected to ChainPay backend');

                // Register wallet if already generated
                if (this.wallet.isInitialized()) {
                    this.registerWallet();
                }
            };

            this.websocket.onclose = () => {
                console.log('❌ WebSocket disconnected');
                this.updateWsStatus('disconnected');
                this.log('error', 'Disconnected from backend. Reconnecting...');

                // Attempt reconnection
                setTimeout(() => this.connectWebSocket(), this.config.reconnectDelay);
            };

            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateWsStatus('disconnected');
            };

            this.websocket.onmessage = (event) => {
                this.handleWebSocketMessage(JSON.parse(event.data));
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.updateWsStatus('disconnected');
            setTimeout(() => this.connectWebSocket(), this.config.reconnectDelay);
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'connected':
                console.log('📡 Received welcome message:', data);
                if (data.config) {
                    this.rewardPerHeartbeat = BigInt(data.config.reward_per_heartbeat || 1000);
                    this.elements.rewardRate.textContent = this.rewardPerHeartbeat.toString();
                    if (data.config.contract_address) {
                        this.elements.contractAddress.textContent = data.config.contract_address;
                    }
                }
                break;

            case 'reward':
                this.handleRewardMessage(data);
                break;

            case 'block':
                this.elements.currentBlock.textContent = data.number;
                this.updateBlockchainStatus('connected');
                break;

            case 'pong':
                // Heartbeat response
                break;

            default:
                console.log('Unknown message type:', data);
        }
    }

    /**
     * Handle reward confirmation from backend
     */
    handleRewardMessage(data) {
        if (data.success) {
            this.heartbeatCount++;
            this.elements.heartbeatCount.textContent = this.heartbeatCount;

            const rewardWei = BigInt(data.reward_wei || 0);
            this.sessionEarnings += rewardWei;
            this.elements.sessionEarnings.textContent = this.sessionEarnings.toString();

            if (data.balance_wei) {
                this.wallet.updateBalance(data.balance_wei);
                this.updateBalanceDisplay();
            }

            const txHashShort = data.tx_hash ? data.tx_hash.slice(0, 10) + '...' : 'pending';
            this.log('reward', `💰 Earned ${rewardWei} wei! TX: ${txHashShort}`);
        } else {
            this.log('error', `Reward failed: ${data.error || 'Unknown error'}`);
        }
    }

    /**
     * Generate a new ephemeral wallet
     */
    generateWallet() {
        const walletInfo = this.wallet.generate();
        
        this.elements.walletAddress.textContent = walletInfo.address;
        this.elements.startWatchingBtn.disabled = false;

        this.log('success', `🔑 New wallet generated: ${walletInfo.address.slice(0, 10)}...`);

        // Register with backend
        this.registerWallet();

        // Refresh balance
        this.refreshBalance();
    }

    /**
     * Register wallet with WebSocket backend
     */
    registerWallet() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.wallet.isInitialized()) {
            this.websocket.send(JSON.stringify({
                type: 'register',
                wallet_address: this.wallet.getAddress()
            }));
            console.log('📝 Wallet registered with backend');
        }
    }

    /**
     * Refresh wallet balance from backend
     */
    async refreshBalance() {
        if (!this.wallet.isInitialized()) {
            this.log('info', 'Generate a wallet first to check balance');
            return;
        }

        // In demo mode, just update display with cached balance
        if (this.config.demoMode) {
            this.updateBalanceDisplay();
            return;
        }

        try {
            const response = await fetch(`${this.config.backendUrl}/api/balance/${this.wallet.getAddress()}`);
            if (response.ok) {
                const data = await response.json();
                this.wallet.updateBalance(data.balance_wei);
                this.updateBalanceDisplay();
            }
        } catch (error) {
            console.error('Failed to refresh balance:', error);
        }
    }

    /**
     * Update balance display
     */
    updateBalanceDisplay() {
        const balanceWei = this.wallet.getBalanceWei();
        this.elements.balanceWei.textContent = balanceWei.toString();
        this.elements.balanceEth.textContent = EphemeralWallet.formatWei(balanceWei, 6);
    }

    /**
     * Copy wallet address to clipboard
     */
    async copyAddress() {
        if (!this.wallet.isInitialized()) return;

        try {
            await navigator.clipboard.writeText(this.wallet.getAddress());
            this.log('info', '📋 Address copied to clipboard');
        } catch (error) {
            console.error('Failed to copy address:', error);
        }
    }

    /**
     * Start watching ads and earning
     */
    startWatching() {
        if (!this.wallet.isInitialized()) {
            this.log('error', 'Please generate a wallet first');
            return;
        }

        this.isWatching = true;
        this.watchStartTime = Date.now();
        this.heartbeatCount = 0;
        this.sessionEarnings = BigInt(0);

        this.elements.startWatchingBtn.disabled = true;
        this.elements.stopWatchingBtn.disabled = false;
        this.elements.adDisplay.classList.add('active');
        this.elements.heartbeatCount.textContent = '0';
        this.elements.sessionEarnings.textContent = '0';

        // Show first ad
        this.showNextAd();

        // Start heartbeat timer
        this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.config.heartbeatInterval);

        // Start progress animation
        this.updateProgress();

        this.log('success', '▶️ Started watching ads - Earning mode activated!');
    }

    /**
     * Stop watching ads
     */
    stopWatching() {
        this.isWatching = false;

        this.elements.startWatchingBtn.disabled = false;
        this.elements.stopWatchingBtn.disabled = true;
        this.elements.adDisplay.classList.remove('active');
        this.elements.adProgress.style.width = '0%';
        this.elements.adTimer.textContent = '0s';

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        // Reset ad display
        this.elements.adDisplay.innerHTML = `
            <div class="ad-placeholder">
                <div class="ad-icon">🎬</div>
                <p>Click "Start Watching" to begin earning</p>
            </div>
        `;

        const totalEarned = this.sessionEarnings.toString();
        this.log('info', `⏹️ Stopped watching. Session earnings: ${totalEarned} wei (${this.heartbeatCount} heartbeats)`);
    }

    /**
     * Show the next ad in rotation
     */
    showNextAd() {
        const ad = this.sampleAds[this.currentAdIndex];
        this.currentAdIndex = (this.currentAdIndex + 1) % this.sampleAds.length;

        this.elements.adDisplay.innerHTML = `
            <div class="ad-content" style="background: ${ad.gradient}">
                <h3>${ad.title}</h3>
                <p>${ad.subtitle}</p>
            </div>
            <div class="earning-indicator">💰 Earning...</div>
        `;
    }

    /**
     * Send heartbeat to backend
     */
    sendHeartbeat() {
        if (!this.isWatching || !this.wallet.isInitialized()) return;

        // Demo mode - simulate rewards locally
        if (this.config.demoMode) {
            this.simulateDemoHeartbeat();
            this.showNextAd();
            return;
        }

        // Use WebSocket if connected
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
                type: 'heartbeat',
                wallet_address: this.wallet.getAddress(),
                timestamp: Date.now()
            }));
        } else {
            // Fallback to HTTP
            this.sendHeartbeatHttp();
        }

        // Rotate to next ad
        this.showNextAd();
    }

    /**
     * Simulate heartbeat reward in demo mode
     */
    simulateDemoHeartbeat() {
        this.heartbeatCount++;
        this.sessionEarnings += this.rewardPerHeartbeat;
        this.demoBalance += this.rewardPerHeartbeat;
        
        // Update UI
        this.elements.heartbeatCount.textContent = this.heartbeatCount;
        this.elements.sessionEarnings.textContent = this.sessionEarnings.toString();
        this.wallet.updateBalance(this.demoBalance);
        this.updateBalanceDisplay();
        
        // Generate fake tx hash for realism
        const fakeTxHash = '0x' + Array.from({length: 64}, () => 
            Math.floor(Math.random() * 16).toString(16)).join('');
        
        this.log('reward', `+${this.rewardPerHeartbeat} wei (Demo TX: ${fakeTxHash.slice(0, 18)}...)`);
    }

    /**
     * Send heartbeat via HTTP (fallback)
     */
    async sendHeartbeatHttp() {
        try {
            const response = await fetch(`${this.config.backendUrl}/api/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet_address: this.wallet.getAddress(),
                    ad_id: `ad_${this.currentAdIndex}`,
                    duration_ms: this.config.heartbeatInterval
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.handleRewardMessage({
                    success: data.success,
                    reward_wei: data.reward_wei,
                    tx_hash: data.tx_hash,
                    balance_wei: data.new_balance ? 
                        (parseFloat(data.new_balance) * 1e18).toString() : null
                });
            }
        } catch (error) {
            console.error('Heartbeat failed:', error);
        }
    }

    /**
     * Update progress bar animation
     */
    updateProgress() {
        if (!this.isWatching) return;

        const elapsed = Date.now() - this.watchStartTime;
        const progress = (elapsed % this.config.heartbeatInterval) / this.config.heartbeatInterval * 100;
        const seconds = Math.floor(elapsed / 1000);

        this.elements.adProgress.style.width = `${progress}%`;
        this.elements.adTimer.textContent = `${seconds}s`;

        requestAnimationFrame(() => this.updateProgress());
    }

    /**
     * Start background tasks
     */
    startBackgroundTasks() {
        // Skip backend calls in demo mode
        if (this.config.demoMode) {
            return;
        }
        
        // Fetch treasury stats periodically
        this.fetchTreasuryStats();
        setInterval(() => this.fetchTreasuryStats(), 10000);

        // Check backend health
        this.checkBackendHealth();
        setInterval(() => this.checkBackendHealth(), 5000);

        // Refresh balance periodically
        setInterval(() => {
            if (this.wallet.isInitialized()) {
                this.refreshBalance();
            }
        }, this.config.balanceRefreshInterval);
    }

    /**
     * Fetch treasury statistics
     */
    async fetchTreasuryStats() {
        if (this.config.demoMode) return;
        
        try {
            const response = await fetch(`${this.config.backendUrl}/api/stats`);
            if (response.ok) {
                const data = await response.json();
                
                this.elements.treasuryBalance.textContent = 
                    parseFloat(data.treasury_balance).toFixed(4);
                this.elements.totalDistributed.textContent = 
                    parseFloat(data.total_distributed).toFixed(6);
                this.elements.totalClaims.textContent = data.total_claims;
                this.elements.activeConnections.textContent = data.active_connections;
                this.elements.currentBlock.textContent = data.current_block_height;
            }
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        }
    }

    /**
     * Check backend health
     */
    async checkBackendHealth() {
        try {
            const response = await fetch(`${this.config.backendUrl}/api/health`);
            if (response.ok) {
                const data = await response.json();
                this.updateBlockchainStatus(data.blockchain ? 'connected' : 'disconnected');
            } else {
                this.updateBlockchainStatus('disconnected');
            }
        } catch (error) {
            this.updateBlockchainStatus('disconnected');
        }
    }

    /**
     * Update WebSocket connection status
     */
    updateWsStatus(status) {
        const dot = this.elements.wsStatus;
        const text = this.elements.wsStatusText;

        dot.className = 'status-dot ' + status;

        switch (status) {
            case 'connected':
                text.textContent = 'WebSocket Connected';
                break;
            case 'disconnected':
                text.textContent = 'WebSocket Disconnected';
                break;
            case 'connecting':
                text.textContent = 'Connecting...';
                dot.className = 'status-dot connecting';
                break;
            case 'demo':
                text.textContent = '🎮 Demo Mode (Simulated)';
                dot.className = 'status-dot connected';
                break;
        }
    }

    /**
     * Update blockchain connection status
     */
    updateBlockchainStatus(status) {
        const dot = this.elements.blockchainStatus;
        const text = this.elements.blockchainStatusText;

        if (!dot || !text) return;
        
        dot.className = 'status-dot ' + status;

        switch (status) {
            case 'connected':
                text.textContent = 'Blockchain Connected';
                break;
            case 'disconnected':
                text.textContent = 'Blockchain Disconnected';
                break;
            case 'demo':
                text.textContent = '🎮 Demo Blockchain';
                dot.className = 'status-dot connected';
                break;
            default:
                text.textContent = 'Connecting...';
        }
    }

    /**
     * Start simulated block updates for demo mode
     */
    startDemoBlockUpdates() {
        let blockNumber = 1000000 + Math.floor(Math.random() * 100000);
        
        // Update block number every 2 seconds
        setInterval(() => {
            blockNumber++;
            if (this.elements.currentBlock) {
                this.elements.currentBlock.textContent = blockNumber.toLocaleString();
            }
        }, 2000);
        
        // Set demo treasury values
        if (this.elements.treasuryBalance) {
            this.elements.treasuryBalance.textContent = '100.0 ETH';
        }
        if (this.elements.totalDistributed) {
            this.elements.totalDistributed.textContent = '0.05 ETH';
        }
        if (this.elements.contractAddress) {
            this.elements.contractAddress.textContent = '0xDemo...Contract';
        }
    }

    /**
     * Add entry to transaction log
     */
    log(type, message) {
        const time = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-message">${message}</span>
        `;

        this.elements.transactionLog.appendChild(entry);

        // Auto-scroll if enabled
        if (this.elements.autoScrollLog.checked) {
            this.elements.transactionLog.scrollTop = this.elements.transactionLog.scrollHeight;
        }

        // Limit log entries
        while (this.elements.transactionLog.children.length > 100) {
            this.elements.transactionLog.removeChild(this.elements.transactionLog.firstChild);
        }
    }

    /**
     * Clear transaction log
     */
    clearLog() {
        this.elements.transactionLog.innerHTML = '';
        this.log('info', 'Log cleared');
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chainPayApp = new ChainPayApp();
});

/**
 * ChainPay - Ephemeral Wallet Manager
 * Generates and manages browser-based Ethereum wallets using ethers.js
 */

class EphemeralWallet {
    constructor() {
        this.wallet = null;
        this.address = null;
        this.privateKey = null;
        this.balance = BigInt(0);
    }

    /**
     * Generate a new random wallet
     * @returns {object} Wallet info with address and truncated private key
     */
    generate() {
        // Create a random wallet using ethers.js
        this.wallet = ethers.Wallet.createRandom();
        this.address = this.wallet.address;
        this.privateKey = this.wallet.privateKey;
        this.balance = BigInt(0);

        console.log('🔑 New ephemeral wallet generated:', this.address);

        return {
            address: this.address,
            privateKeyTruncated: this.privateKey.slice(0, 10) + '...' + this.privateKey.slice(-4)
        };
    }

    /**
     * Import an existing wallet from private key
     * @param {string} privateKey - Private key in hex format
     * @returns {object} Wallet info
     */
    import(privateKey) {
        try {
            this.wallet = new ethers.Wallet(privateKey);
            this.address = this.wallet.address;
            this.privateKey = this.wallet.privateKey;
            this.balance = BigInt(0);

            console.log('📥 Wallet imported:', this.address);

            return {
                address: this.address,
                success: true
            };
        } catch (error) {
            console.error('❌ Failed to import wallet:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get the wallet address
     * @returns {string|null} Wallet address or null if not generated
     */
    getAddress() {
        return this.address;
    }

    /**
     * Check if wallet is initialized
     * @returns {boolean}
     */
    isInitialized() {
        return this.wallet !== null;
    }

    /**
     * Update the cached balance
     * @param {BigInt|string} newBalance - Balance in wei
     */
    updateBalance(newBalance) {
        if (typeof newBalance === 'string') {
            this.balance = BigInt(newBalance);
        } else {
            this.balance = newBalance;
        }
    }

    /**
     * Get cached balance in wei
     * @returns {BigInt}
     */
    getBalanceWei() {
        return this.balance;
    }

    /**
     * Get cached balance in Ether (as string)
     * @returns {string}
     */
    getBalanceEther() {
        return ethers.formatEther(this.balance);
    }

    /**
     * Format wei to a readable string with specified precision
     * @param {BigInt|string} wei - Amount in wei
     * @param {number} precision - Decimal places
     * @returns {string}
     */
    static formatWei(wei, precision = 6) {
        const weiBI = typeof wei === 'string' ? BigInt(wei) : wei;
        const etherStr = ethers.formatEther(weiBI);
        const num = parseFloat(etherStr);
        return num.toFixed(precision);
    }

    /**
     * Sign a message (for future use with authenticated heartbeats)
     * @param {string} message - Message to sign
     * @returns {Promise<string>} Signature
     */
    async signMessage(message) {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }
        return await this.wallet.signMessage(message);
    }

    /**
     * Export wallet data (for backup - use with caution)
     * @returns {object} Wallet export data
     */
    export() {
        if (!this.wallet) {
            return null;
        }
        return {
            address: this.address,
            privateKey: this.privateKey,
            // Warning: Never expose this in production
            warning: 'Keep this private key secure!'
        };
    }

    /**
     * Clear wallet from memory
     */
    clear() {
        this.wallet = null;
        this.address = null;
        this.privateKey = null;
        this.balance = BigInt(0);
        console.log('🗑️ Wallet cleared from memory');
    }
}

// Export for use in app.js
window.EphemeralWallet = EphemeralWallet;

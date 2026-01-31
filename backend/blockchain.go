package main

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// RewardTreasury ABI (minimal required functions)
const RewardTreasuryABI = `[
	{"inputs":[{"internalType":"address payable","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"bytes32","name":"claimId","type":"bytes32"}],"name":"processReward","outputs":[],"stateMutability":"nonpayable","type":"function"},
	{"inputs":[],"name":"getStats","outputs":[{"internalType":"uint256","name":"balance","type":"uint256"},{"internalType":"uint256","name":"totalDistributed","type":"uint256"},{"internalType":"uint256","name":"totalClaims","type":"uint256"},{"internalType":"uint256","name":"ratePerHeartbeat","type":"uint256"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"getTreasuryBalance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
	{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getUserEarnings","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"rewardPerHeartbeat","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"totalRewardsDistributed","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
	{"inputs":[],"name":"totalClaimsProcessed","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]`

// ContractStats holds treasury statistics
type ContractStats struct {
	Balance          *big.Int
	TotalDistributed *big.Int
	TotalClaims      int64
	RewardRate       *big.Int
}

// BlockchainClient handles all blockchain interactions
type BlockchainClient struct {
	client          *ethclient.Client
	config          *Config
	privateKey      *ecdsa.PrivateKey
	signerAddress   common.Address
	contractAddress common.Address
	contractABI     abi.ABI
	chainID         *big.Int
	nonceMux        sync.Mutex
	currentNonce    uint64
	connected       bool
}

// NewBlockchainClient creates a new blockchain client
func NewBlockchainClient(config *Config) (*BlockchainClient, error) {
	log.Printf("🔗 Connecting to blockchain at %s...", config.RPCEndpoint)

	client, err := ethclient.Dial(config.RPCEndpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to RPC: %w", err)
	}

	// Get chain ID
	chainID, err := client.ChainID(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to get chain ID: %w", err)
	}
	log.Printf("📊 Connected to chain ID: %s", chainID.String())

	// Parse private key
	privateKeyHex := strings.TrimPrefix(config.SignerPrivateKey, "0x")
	privateKey, err := crypto.HexToECDSA(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	// Get signer address from private key
	publicKey := privateKey.Public()
	publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, errors.New("failed to get public key")
	}
	signerAddress := crypto.PubkeyToAddress(*publicKeyECDSA)
	log.Printf("🔑 Signer address: %s", signerAddress.Hex())

	// Check signer balance
	balance, err := client.BalanceAt(context.Background(), signerAddress, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get signer balance: %w", err)
	}
	log.Printf("💰 Signer balance: %s ETH", weiToEther(balance))

	// Parse contract ABI
	contractABI, err := abi.JSON(strings.NewReader(RewardTreasuryABI))
	if err != nil {
		return nil, fmt.Errorf("failed to parse contract ABI: %w", err)
	}

	// Get initial nonce
	nonce, err := client.PendingNonceAt(context.Background(), signerAddress)
	if err != nil {
		return nil, fmt.Errorf("failed to get nonce: %w", err)
	}

	bc := &BlockchainClient{
		client:        client,
		config:        config,
		privateKey:    privateKey,
		signerAddress: signerAddress,
		contractABI:   contractABI,
		chainID:       chainID,
		currentNonce:  nonce,
		connected:     true,
	}

	// Set contract address if provided
	if config.ContractAddress != "" {
		bc.contractAddress = common.HexToAddress(config.ContractAddress)
		log.Printf("📜 Contract address: %s", bc.contractAddress.Hex())
	}

	return bc, nil
}

// Close closes the blockchain client
func (bc *BlockchainClient) Close() {
	bc.client.Close()
	bc.connected = false
}

// IsConnected returns connection status
func (bc *BlockchainClient) IsConnected() bool {
	if !bc.connected {
		return false
	}

	_, err := bc.client.BlockNumber(context.Background())
	return err == nil
}

// GetBalance returns the ETH balance of an address
func (bc *BlockchainClient) GetBalance(address string) (*big.Int, error) {
	if !common.IsHexAddress(address) {
		return nil, errors.New("invalid address format")
	}

	addr := common.HexToAddress(address)
	balance, err := bc.client.BalanceAt(context.Background(), addr, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get balance: %w", err)
	}

	return balance, nil
}

// GetBlockNumber returns the current block number
func (bc *BlockchainClient) GetBlockNumber() (uint64, error) {
	return bc.client.BlockNumber(context.Background())
}

// GetLatestBlock returns information about the latest block
func (bc *BlockchainClient) GetLatestBlock() (*BlockInfo, error) {
	block, err := bc.client.BlockByNumber(context.Background(), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get block: %w", err)
	}

	return &BlockInfo{
		Number:    block.NumberU64(),
		Hash:      block.Hash().Hex(),
		Timestamp: time.Unix(int64(block.Time()), 0),
		TxCount:   len(block.Transactions()),
	}, nil
}

// ProcessReward sends a reward to a user via the smart contract
func (bc *BlockchainClient) ProcessReward(recipient string, amount *big.Int) (string, error) {
	if bc.contractAddress == (common.Address{}) {
		// Fallback: Direct ETH transfer if no contract
		return bc.sendDirectTransfer(recipient, amount)
	}

	return bc.sendContractReward(recipient, amount)
}

// sendContractReward sends reward through the smart contract
func (bc *BlockchainClient) sendContractReward(recipient string, amount *big.Int) (string, error) {
	if !common.IsHexAddress(recipient) {
		return "", errors.New("invalid recipient address")
	}

	recipientAddr := common.HexToAddress(recipient)

	// Generate unique claim ID
	claimID := crypto.Keccak256Hash(
		recipientAddr.Bytes(),
		amount.Bytes(),
		big.NewInt(time.Now().UnixNano()).Bytes(),
	)

	// Pack the function call
	data, err := bc.contractABI.Pack("processReward", recipientAddr, amount, claimID)
	if err != nil {
		return "", fmt.Errorf("failed to pack function call: %w", err)
	}

	// Get gas price
	gasPrice, err := bc.client.SuggestGasPrice(context.Background())
	if err != nil {
		return "", fmt.Errorf("failed to get gas price: %w", err)
	}

	// Get nonce with mutex to prevent race conditions
	bc.nonceMux.Lock()
	nonce := bc.currentNonce
	bc.currentNonce++
	bc.nonceMux.Unlock()

	// Estimate gas
	msg := ethereum.CallMsg{
		From:     bc.signerAddress,
		To:       &bc.contractAddress,
		GasPrice: gasPrice,
		Data:     data,
	}

	gasLimit, err := bc.client.EstimateGas(context.Background(), msg)
	if err != nil {
		// Reset nonce on failure
		bc.nonceMux.Lock()
		bc.currentNonce--
		bc.nonceMux.Unlock()
		return "", fmt.Errorf("failed to estimate gas: %w", err)
	}

	// Create transaction
	tx := types.NewTransaction(
		nonce,
		bc.contractAddress,
		big.NewInt(0), // No ETH value, contract handles transfer
		gasLimit,
		gasPrice,
		data,
	)

	// Sign transaction
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(bc.chainID), bc.privateKey)
	if err != nil {
		bc.nonceMux.Lock()
		bc.currentNonce--
		bc.nonceMux.Unlock()
		return "", fmt.Errorf("failed to sign transaction: %w", err)
	}

	// Send transaction
	err = bc.client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		bc.nonceMux.Lock()
		bc.currentNonce--
		bc.nonceMux.Unlock()
		return "", fmt.Errorf("failed to send transaction: %w", err)
	}

	return signedTx.Hash().Hex(), nil
}

// sendDirectTransfer sends ETH directly (fallback when no contract)
func (bc *BlockchainClient) sendDirectTransfer(recipient string, amount *big.Int) (string, error) {
	if !common.IsHexAddress(recipient) {
		return "", errors.New("invalid recipient address")
	}

	recipientAddr := common.HexToAddress(recipient)

	// Get gas price
	gasPrice, err := bc.client.SuggestGasPrice(context.Background())
	if err != nil {
		return "", fmt.Errorf("failed to get gas price: %w", err)
	}

	// Get nonce with mutex
	bc.nonceMux.Lock()
	nonce := bc.currentNonce
	bc.currentNonce++
	bc.nonceMux.Unlock()

	// Create transaction
	tx := types.NewTransaction(
		nonce,
		recipientAddr,
		amount,
		21000, // Standard gas limit for ETH transfer
		gasPrice,
		nil,
	)

	// Sign transaction
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(bc.chainID), bc.privateKey)
	if err != nil {
		bc.nonceMux.Lock()
		bc.currentNonce--
		bc.nonceMux.Unlock()
		return "", fmt.Errorf("failed to sign transaction: %w", err)
	}

	// Send transaction
	err = bc.client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		bc.nonceMux.Lock()
		bc.currentNonce--
		bc.nonceMux.Unlock()
		return "", fmt.Errorf("failed to send transaction: %w", err)
	}

	return signedTx.Hash().Hex(), nil
}

// GetContractStats retrieves treasury statistics from the contract
func (bc *BlockchainClient) GetContractStats() (*ContractStats, error) {
	if bc.contractAddress == (common.Address{}) {
		// Return mock stats if no contract
		signerBalance, _ := bc.GetBalance(bc.signerAddress.Hex())
		return &ContractStats{
			Balance:          signerBalance,
			TotalDistributed: big.NewInt(0),
			TotalClaims:      0,
			RewardRate:       big.NewInt(bc.config.RewardPerHeartbeat),
		}, nil
	}

	// Pack the getStats call
	data, err := bc.contractABI.Pack("getStats")
	if err != nil {
		return nil, fmt.Errorf("failed to pack getStats call: %w", err)
	}

	// Call the contract
	result, err := bc.client.CallContract(context.Background(), ethereum.CallMsg{
		To:   &bc.contractAddress,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call contract: %w", err)
	}

	// Unpack the result
	var stats struct {
		Balance          *big.Int
		TotalDistributed *big.Int
		TotalClaims      *big.Int
		RatePerHeartbeat *big.Int
	}

	err = bc.contractABI.UnpackIntoInterface(&stats, "getStats", result)
	if err != nil {
		// Fallback: get individual values
		return bc.getStatsIndividually()
	}

	return &ContractStats{
		Balance:          stats.Balance,
		TotalDistributed: stats.TotalDistributed,
		TotalClaims:      stats.TotalClaims.Int64(),
		RewardRate:       stats.RatePerHeartbeat,
	}, nil
}

// getStatsIndividually gets stats by calling individual functions
func (bc *BlockchainClient) getStatsIndividually() (*ContractStats, error) {
	// Get treasury balance
	balanceData, _ := bc.contractABI.Pack("getTreasuryBalance")
	balanceResult, err := bc.client.CallContract(context.Background(), ethereum.CallMsg{
		To:   &bc.contractAddress,
		Data: balanceData,
	}, nil)

	balance := big.NewInt(0)
	if err == nil && len(balanceResult) >= 32 {
		balance = new(big.Int).SetBytes(balanceResult[:32])
	}

	return &ContractStats{
		Balance:          balance,
		TotalDistributed: big.NewInt(0),
		TotalClaims:      0,
		RewardRate:       big.NewInt(bc.config.RewardPerHeartbeat),
	}, nil
}

// GetUserEarnings returns total earnings for a user from the contract
func (bc *BlockchainClient) GetUserEarnings(address string) (*big.Int, error) {
	if bc.contractAddress == (common.Address{}) {
		return big.NewInt(0), nil
	}

	if !common.IsHexAddress(address) {
		return nil, errors.New("invalid address format")
	}

	addr := common.HexToAddress(address)

	data, err := bc.contractABI.Pack("getUserEarnings", addr)
	if err != nil {
		return nil, fmt.Errorf("failed to pack call: %w", err)
	}

	result, err := bc.client.CallContract(context.Background(), ethereum.CallMsg{
		To:   &bc.contractAddress,
		Data: data,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to call contract: %w", err)
	}

	if len(result) < 32 {
		return big.NewInt(0), nil
	}

	earnings := new(big.Int).SetBytes(result[:32])
	return earnings, nil
}

// WaitForTransaction waits for a transaction to be mined
func (bc *BlockchainClient) WaitForTransaction(txHash string) (*types.Receipt, error) {
	hash := common.HexToHash(txHash)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	receipt, err := bind.WaitMined(ctx, bc.client, &types.Transaction{})
	if err != nil {
		// Try to get receipt directly
		for i := 0; i < 30; i++ {
			receipt, err := bc.client.TransactionReceipt(context.Background(), hash)
			if err == nil {
				return receipt, nil
			}
			time.Sleep(time.Second)
		}
		return nil, fmt.Errorf("timeout waiting for transaction: %w", err)
	}

	return receipt, nil
}

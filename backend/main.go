package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

// Config holds application configuration
type Config struct {
	RPCEndpoint        string `json:"rpc_endpoint"`
	ContractAddress    string `json:"contract_address"`
	SignerPrivateKey   string `json:"signer_private_key"`
	HTTPPort           string `json:"http_port"`
	RewardPerHeartbeat int64  `json:"reward_per_heartbeat"` // Wei
}

// Server is the main application server
type Server struct {
	config       *Config
	blockchain   *BlockchainClient
	router       *mux.Router
	upgrader     websocket.Upgrader
	clients      map[*websocket.Conn]*ClientSession
	clientsMux   sync.RWMutex
	blockUpdates chan *BlockInfo
	rewardQueue  chan *RewardRequest
	stats        *ServerStats
	statsMux     sync.RWMutex
}

// ClientSession tracks a connected client
type ClientSession struct {
	WalletAddress string
	Heartbeats    int64
	TotalEarned   *big.Int
	ConnectedAt   time.Time
}

// ServerStats tracks server-wide statistics
type ServerStats struct {
	TotalHeartbeats   int64
	TotalRewards      *big.Int
	ActiveConnections int
	BlockHeight       uint64
	LastBlockTime     time.Time
}

// RewardRequest represents a pending reward
type RewardRequest struct {
	WalletAddress string
	Amount        *big.Int
	Heartbeats    int64
	Timestamp     time.Time
}

// API Response types
type BalanceResponse struct {
	Address    string `json:"address"`
	Balance    string `json:"balance"`
	BalanceWei string `json:"balance_wei"`
}

type HeartbeatRequest struct {
	WalletAddress string `json:"wallet_address"`
	AdID          string `json:"ad_id"`
	Duration      int    `json:"duration_ms"`
}

type HeartbeatResponse struct {
	Success    bool   `json:"success"`
	RewardWei  string `json:"reward_wei"`
	TxHash     string `json:"tx_hash,omitempty"`
	Message    string `json:"message"`
	NewBalance string `json:"new_balance,omitempty"`
}

type StatsResponse struct {
	TreasuryBalance    string `json:"treasury_balance"`
	TreasuryBalanceWei string `json:"treasury_balance_wei"`
	TotalDistributed   string `json:"total_distributed"`
	TotalClaims        int64  `json:"total_claims"`
	CurrentBlockHeight uint64 `json:"current_block_height"`
	ActiveConnections  int    `json:"active_connections"`
	RewardPerHeartbeat string `json:"reward_per_heartbeat"`
}

type BlockInfo struct {
	Number    uint64    `json:"number"`
	Hash      string    `json:"hash"`
	Timestamp time.Time `json:"timestamp"`
	TxCount   int       `json:"tx_count"`
}

func main() {
	log.Println("🚀 Starting ChainPay Watch-to-Earn Backend...")

	// Load configuration
	config := loadConfig()

	// Initialize blockchain client
	blockchain, err := NewBlockchainClient(config)
	if err != nil {
		log.Fatalf("❌ Failed to connect to blockchain: %v", err)
	}
	defer blockchain.Close()

	// Create server
	server := &Server{
		config:     config,
		blockchain: blockchain,
		router:     mux.NewRouter(),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		clients:      make(map[*websocket.Conn]*ClientSession),
		blockUpdates: make(chan *BlockInfo, 100),
		rewardQueue:  make(chan *RewardRequest, 1000),
		stats: &ServerStats{
			TotalRewards: big.NewInt(0),
		},
	}

	// Setup routes
	server.setupRoutes()

	// Start background workers
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go server.blockMonitor(ctx)
	go server.rewardProcessor(ctx)
	go server.broadcastUpdates(ctx)

	// Setup HTTP server with CORS
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})

	httpServer := &http.Server{
		Addr:         ":" + config.HTTPPort,
		Handler:      c.Handler(server.router),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Printf("✅ HTTP server listening on port %s", config.HTTPPort)
		log.Printf("📡 WebSocket available at ws://localhost:%s/ws", config.HTTPPort)
		if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("❌ HTTP server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("🛑 Shutting down server...")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("⚠️ HTTP shutdown error: %v", err)
	}

	log.Println("👋 Server stopped")
}

func loadConfig() *Config {
	// Default configuration for local development
	config := &Config{
		RPCEndpoint:        "http://127.0.0.1:8545",
		ContractAddress:    "",                                                                   // Will be loaded from deployment
		SignerPrivateKey:   "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // Hardhat account #1
		HTTPPort:           "8080",
		RewardPerHeartbeat: 1000, // 1000 wei per heartbeat
	}

	// Try to load contract address from deployment file
	deploymentFile := "../blockchain/deployments/localhost.json"
	if data, err := os.ReadFile(deploymentFile); err == nil {
		var deployment struct {
			Contracts struct {
				RewardTreasury struct {
					Address string `json:"address"`
				} `json:"RewardTreasury"`
			} `json:"contracts"`
			Accounts struct {
				RewardSignerPrivateKey string `json:"rewardSignerPrivateKey"`
			} `json:"accounts"`
		}
		if err := json.Unmarshal(data, &deployment); err == nil {
			if deployment.Contracts.RewardTreasury.Address != "" {
				config.ContractAddress = deployment.Contracts.RewardTreasury.Address
				log.Printf("📄 Loaded contract address: %s", config.ContractAddress)
			}
			if deployment.Accounts.RewardSignerPrivateKey != "" {
				config.SignerPrivateKey = deployment.Accounts.RewardSignerPrivateKey
			}
		}
	}

	// Override with environment variables if set
	if rpc := os.Getenv("RPC_ENDPOINT"); rpc != "" {
		config.RPCEndpoint = rpc
	}
	if addr := os.Getenv("CONTRACT_ADDRESS"); addr != "" {
		config.ContractAddress = addr
	}
	if key := os.Getenv("SIGNER_PRIVATE_KEY"); key != "" {
		config.SignerPrivateKey = key
	}
	if port := os.Getenv("HTTP_PORT"); port != "" {
		config.HTTPPort = port
	}

	return config
}

func (s *Server) setupRoutes() {
	// API routes
	api := s.router.PathPrefix("/api").Subrouter()

	api.HandleFunc("/health", s.handleHealth).Methods("GET")
	api.HandleFunc("/stats", s.handleStats).Methods("GET")
	api.HandleFunc("/balance/{address}", s.handleBalance).Methods("GET")
	api.HandleFunc("/heartbeat", s.handleHeartbeat).Methods("POST")
	api.HandleFunc("/treasury", s.handleTreasury).Methods("GET")
	api.HandleFunc("/block/latest", s.handleLatestBlock).Methods("GET")
	api.HandleFunc("/user/{address}/earnings", s.handleUserEarnings).Methods("GET")

	// WebSocket for real-time updates
	s.router.HandleFunc("/ws", s.handleWebSocket)

	log.Println("📍 API routes configured")
}

// handleHealth returns server health status
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	connected := s.blockchain.IsConnected()
	status := map[string]interface{}{
		"status":     "ok",
		"blockchain": connected,
		"timestamp":  time.Now().Unix(),
	}

	if !connected {
		status["status"] = "degraded"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// handleStats returns server and blockchain statistics
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.blockchain.GetContractStats()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get stats: %v", err), http.StatusInternalServerError)
		return
	}

	s.clientsMux.RLock()
	activeConns := len(s.clients)
	s.clientsMux.RUnlock()

	blockNum, _ := s.blockchain.GetBlockNumber()

	response := StatsResponse{
		TreasuryBalance:    weiToEther(stats.Balance),
		TreasuryBalanceWei: stats.Balance.String(),
		TotalDistributed:   weiToEther(stats.TotalDistributed),
		TotalClaims:        stats.TotalClaims,
		CurrentBlockHeight: blockNum,
		ActiveConnections:  activeConns,
		RewardPerHeartbeat: big.NewInt(s.config.RewardPerHeartbeat).String(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleBalance returns the ETH balance of an address
func (s *Server) handleBalance(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := vars["address"]

	balance, err := s.blockchain.GetBalance(address)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get balance: %v", err), http.StatusBadRequest)
		return
	}

	response := BalanceResponse{
		Address:    address,
		Balance:    weiToEther(balance),
		BalanceWei: balance.String(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleHeartbeat processes an ad-view heartbeat and triggers reward
func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	var req HeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.WalletAddress == "" {
		http.Error(w, "Wallet address required", http.StatusBadRequest)
		return
	}

	// Calculate reward
	rewardWei := big.NewInt(s.config.RewardPerHeartbeat)

	// Process reward on blockchain
	txHash, err := s.blockchain.ProcessReward(req.WalletAddress, rewardWei)
	if err != nil {
		log.Printf("⚠️ Failed to process reward for %s: %v", req.WalletAddress, err)

		response := HeartbeatResponse{
			Success:   false,
			RewardWei: rewardWei.String(),
			Message:   fmt.Sprintf("Reward queued but transaction failed: %v", err),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Get new balance
	newBalance, _ := s.blockchain.GetBalance(req.WalletAddress)
	newBalanceStr := ""
	if newBalance != nil {
		newBalanceStr = weiToEther(newBalance)
	}

	// Update stats
	s.statsMux.Lock()
	s.stats.TotalHeartbeats++
	s.stats.TotalRewards.Add(s.stats.TotalRewards, rewardWei)
	s.statsMux.Unlock()

	response := HeartbeatResponse{
		Success:    true,
		RewardWei:  rewardWei.String(),
		TxHash:     txHash,
		Message:    "Reward processed successfully",
		NewBalance: newBalanceStr,
	}

	log.Printf("💰 Reward sent: %s wei to %s (tx: %s)", rewardWei.String(), req.WalletAddress[:10]+"...", txHash[:16]+"...")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleTreasury returns treasury contract info
func (s *Server) handleTreasury(w http.ResponseWriter, r *http.Request) {
	stats, err := s.blockchain.GetContractStats()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get treasury info: %v", err), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"contract_address":     s.config.ContractAddress,
		"balance":              weiToEther(stats.Balance),
		"balance_wei":          stats.Balance.String(),
		"total_distributed":    weiToEther(stats.TotalDistributed),
		"total_claims":         stats.TotalClaims,
		"reward_per_heartbeat": stats.RewardRate.String(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleLatestBlock returns the latest block info
func (s *Server) handleLatestBlock(w http.ResponseWriter, r *http.Request) {
	block, err := s.blockchain.GetLatestBlock()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get block: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(block)
}

// handleUserEarnings returns total earnings for a user
func (s *Server) handleUserEarnings(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	address := vars["address"]

	earnings, err := s.blockchain.GetUserEarnings(address)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get earnings: %v", err), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"address":      address,
		"earnings":     weiToEther(earnings),
		"earnings_wei": earnings.String(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleWebSocket handles WebSocket connections for real-time updates
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("❌ WebSocket upgrade failed: %v", err)
		return
	}

	session := &ClientSession{
		TotalEarned: big.NewInt(0),
		ConnectedAt: time.Now(),
	}

	s.clientsMux.Lock()
	s.clients[conn] = session
	s.clientsMux.Unlock()

	log.Printf("🔗 New WebSocket connection (total: %d)", len(s.clients))

	// Send welcome message
	welcome := map[string]interface{}{
		"type":    "connected",
		"message": "Connected to ChainPay Watch-to-Earn",
		"config": map[string]interface{}{
			"reward_per_heartbeat": s.config.RewardPerHeartbeat,
			"contract_address":     s.config.ContractAddress,
		},
	}
	conn.WriteJSON(welcome)

	// Handle incoming messages
	go s.handleWSMessages(conn, session)
}

func (s *Server) handleWSMessages(conn *websocket.Conn, session *ClientSession) {
	defer func() {
		s.clientsMux.Lock()
		delete(s.clients, conn)
		s.clientsMux.Unlock()
		conn.Close()
		log.Printf("🔌 WebSocket disconnected (remaining: %d)", len(s.clients))
	}()

	for {
		var msg map[string]interface{}
		err := conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("⚠️ WebSocket error: %v", err)
			}
			break
		}

		// Handle different message types
		switch msg["type"] {
		case "register":
			if addr, ok := msg["wallet_address"].(string); ok {
				session.WalletAddress = addr
				log.Printf("📝 Registered wallet: %s", addr[:10]+"...")
			}

		case "heartbeat":
			if session.WalletAddress != "" {
				session.Heartbeats++
				rewardWei := big.NewInt(s.config.RewardPerHeartbeat)

				txHash, err := s.blockchain.ProcessReward(session.WalletAddress, rewardWei)

				response := map[string]interface{}{
					"type":       "reward",
					"success":    err == nil,
					"reward_wei": rewardWei.String(),
					"tx_hash":    txHash,
					"heartbeats": session.Heartbeats,
				}

				if err == nil {
					session.TotalEarned.Add(session.TotalEarned, rewardWei)
					response["total_earned"] = session.TotalEarned.String()

					// Get updated balance
					if balance, err := s.blockchain.GetBalance(session.WalletAddress); err == nil {
						response["balance"] = weiToEther(balance)
						response["balance_wei"] = balance.String()
					}
				} else {
					response["error"] = err.Error()
				}

				conn.WriteJSON(response)
			}

		case "ping":
			conn.WriteJSON(map[string]string{"type": "pong"})
		}
	}
}

// blockMonitor watches for new blocks
func (s *Server) blockMonitor(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	var lastBlock uint64

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			block, err := s.blockchain.GetLatestBlock()
			if err != nil {
				continue
			}

			if block.Number > lastBlock {
				lastBlock = block.Number
				s.blockUpdates <- block

				s.statsMux.Lock()
				s.stats.BlockHeight = block.Number
				s.stats.LastBlockTime = block.Timestamp
				s.statsMux.Unlock()
			}
		}
	}
}

// rewardProcessor handles queued rewards
func (s *Server) rewardProcessor(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case req := <-s.rewardQueue:
			_, err := s.blockchain.ProcessReward(req.WalletAddress, req.Amount)
			if err != nil {
				log.Printf("⚠️ Failed to process queued reward: %v", err)
			}
		}
	}
}

// broadcastUpdates sends block updates to all WebSocket clients
func (s *Server) broadcastUpdates(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case block := <-s.blockUpdates:
			msg := map[string]interface{}{
				"type":      "block",
				"number":    block.Number,
				"hash":      block.Hash,
				"timestamp": block.Timestamp.Unix(),
				"tx_count":  block.TxCount,
			}

			s.clientsMux.RLock()
			for conn := range s.clients {
				conn.WriteJSON(msg)
			}
			s.clientsMux.RUnlock()
		}
	}
}

// Helper function to convert wei to ether string
func weiToEther(wei *big.Int) string {
	if wei == nil {
		return "0"
	}

	ether := new(big.Float).SetInt(wei)
	divisor := new(big.Float).SetInt(big.NewInt(1e18))
	ether.Quo(ether, divisor)

	return ether.Text('f', 18)
}

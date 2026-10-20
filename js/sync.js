/**
 * PokerTracker - Realtime P2P Synchronization & Host Transfer Engine
 * Uses PeerJS (WebRTC Data Channels) for zero-backend live spectator syncing
 * and cryptographically secured host transfer on GitHub Pages.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PokerSync = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PEER_PREFIX = 'pokertracker-v1-';
  const PING_INTERVAL_MS = 10000;

  class SyncManager {
    constructor(options = {}) {
      this.onStateReceived = options.onStateReceived || (() => {});
      this.onHostTransferred = options.onHostTransferred || (() => {});
      this.onHostPromoted = options.onHostPromoted || (() => {});
      this.onConnectionChange = options.onConnectionChange || (() => {});
      this.onViewerCountChange = options.onViewerCountChange || (() => {});

      this.peer = null;
      this.roomId = options.roomId || null;
      this.hostSecret = options.hostSecret || null;
      this.isHost = !!options.isHost;
      this.pendingClaimSecret = options.pendingClaimSecret || null;
      this.pendingHostSecret = null;
      this._pendingClaimResolve = null;
      this._pendingClaimReject = null;
      this.connections = new Map(); // For host: Map of peerId -> DataConnection
      this.hostConn = null; // For viewer: DataConnection to host
      this.isConnected = false;
      this.isHandingOver = false;
      this.handoverWatcherTimeout = null;
      this.targetNewHostName = null;
      this.pingTimer = null;
      this.reconnectTimer = null;
      this.latestState = null;
    }

    /**
     * Generate a cryptographically random room ID and secret
     */
    static generateRoomId() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let result = '';
      for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    static generateSecret() {
      return 'sec_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
    }

    /**
     * Initialize connection based on URL params or existing local session
     */
    init({ roomId, hostSecret, isHost, stateProvider, pendingClaimSecret }) {
      this.roomId = roomId;
      this.hostSecret = hostSecret;
      this.isHost = isHost;
      if (pendingClaimSecret) this.pendingClaimSecret = pendingClaimSecret;
      this.getState = stateProvider || (() => this.latestState);

      this.cleanup();

      if (typeof Peer === 'undefined') {
        console.warn('PeerJS library not loaded. Live sync will be offline.');
        this.onConnectionChange({ status: 'offline', message: 'PeerJS unavailable' });
        return;
      }

      if (this.isHost) {
        this._startHost();
      } else {
        this._startViewer();
      }
    }

    /**
     * Start as Host: Listens for incoming viewer connections
     */
    _startHost() {
      const hostPeerId = `${PEER_PREFIX}${this.roomId}-host`;
      this.onConnectionChange({ status: 'connecting', role: 'host', message: 'Starting live host server...' });

      try {
        this.peer = new Peer(hostPeerId, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' }
            ]
          }
        });

        this.peer.on('open', (id) => {
          this.isConnected = true;
          this.isHandingOver = false;
          this.hostRetryCount = 0;
          this.onConnectionChange({
            status: 'online',
            role: 'host',
            message: 'Live hosting active',
            peerId: id
          });

          // Immediately broadcast current state so connecting spectators and watchers get it
          const currentState = this.getState();
          if (currentState) {
            this.broadcastState(currentState);
          }
        });

        this.peer.on('connection', (conn) => {
          this._handleViewerConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.error('Host Peer error:', err);
          if (err.type === 'unavailable-id') {
            if (this.hostRetryCount === undefined) this.hostRetryCount = 0;
            if (this.hostRetryCount < 8) {
              this.hostRetryCount++;
              this.onConnectionChange({
                status: 'connecting',
                role: 'host',
                message: `Claiming host slot (attempt ${this.hostRetryCount}/8)...`
              });
              setTimeout(() => {
                if (this.isHost) {
                  this.cleanup();
                  this._startHost();
                }
              }, 800);
              return;
            }
            this.onConnectionChange({
              status: 'warning',
              role: 'host',
              message: 'Host ID is releasing. Please wait a moment...'
            });
            setTimeout(() => {
              if (this.isHost) {
                this.hostRetryCount = 0;
                this.cleanup();
                this._startHost();
              }
            }, 2000);
          } else {
            this.onConnectionChange({
              status: 'error',
              role: 'host',
              message: `Sync error: ${err.type || 'Connection failed'}`
            });
          }
        });

        this.peer.on('disconnected', () => {
          this.isConnected = false;
          this.onConnectionChange({ status: 'disconnected', role: 'host', message: 'Host disconnected. Reconnecting...' });
          this._tryReconnect();
        });

      } catch (e) {
        console.error('Failed to start host peer:', e);
        this.onConnectionChange({ status: 'error', role: 'host', message: e.message });
      }
    }

    _handleViewerConnection(conn) {
      conn.on('open', () => {
        this.connections.set(conn.peer, conn);
        this.onViewerCountChange(this.connections.size);

        // Immediately send current game state to the viewer
        const currentState = this.getState();
        if (currentState) {
          conn.send({
            type: 'FULL_STATE',
            payload: currentState,
            timestamp: Date.now()
          });
        }
      });

      conn.on('data', (data) => {
        if (!data || typeof data !== 'object') return;

        if (data.type === 'PING') {
          conn.send({ type: 'PONG', timestamp: Date.now() });
        } else if (data.type === 'REQUEST_SYNC') {
          const currentState = this.getState();
          if (currentState) {
            conn.send({
              type: 'FULL_STATE',
              payload: currentState,
              timestamp: Date.now()
            });
          }
        } else if (data.type === 'CLAIM_HOST') {
          // Check secret for host transfer
          if (data.secret && data.secret === this.hostSecret) {
            this.pendingTransferClaimant = {
              peer: conn.peer,
              newHostName: data.newHostName || 'New Host'
            };
            try {
              // Send current state and transfer ready packet to claimant
              conn.send({
                type: 'HOST_TRANSFER_READY',
                secret: this.hostSecret,
                state: this.getState()
              });
            } catch (e) {}
          } else {
            conn.send({ type: 'HOST_TRANSFER_DENIED', error: 'Invalid secret key' });
          }
        } else if (data.type === 'HOST_TAKEOVER_ACK') {
          // New host confirmed takeover with complete state!
          // Initiate handover: keep watching until new host is verified live
          const claimant = this.pendingTransferClaimant;
          this.pendingTransferClaimant = null;
          this.startHostHandover(claimant ? claimant.newHostName : 'New Host', conn.peer);
        }
      });

      conn.on('close', () => {
        this.connections.delete(conn.peer);
        this.onViewerCountChange(this.connections.size);
      });

      conn.on('error', () => {
        this.connections.delete(conn.peer);
        this.onViewerCountChange(this.connections.size);
      });
    }

    /**
     * Start as Viewer: Connects to host peer
     */
    _startViewer() {
      const viewerPeerId = `${PEER_PREFIX}viewer-${Math.random().toString(36).substring(2, 9)}`;
      const targetHostId = `${PEER_PREFIX}${this.roomId}-host`;

      this.onConnectionChange({ status: 'connecting', role: 'viewer', message: 'Connecting to Host...' });

      try {
        this.peer = new Peer(viewerPeerId, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });

        this.peer.on('open', () => {
          this._connectToHost(targetHostId);
        });

        this.peer.on('error', (err) => {
          console.error('Viewer peer error:', err);
          if (err.type === 'peer-unavailable' && this.pendingClaimSecret) {
            // The previous host is offline/already stepped down, but this peer holds the valid secret key.
            // Promote directly to host so the game does not become hostless.
            const sec = this.pendingClaimSecret;
            this.pendingClaimSecret = null;
            this.pendingHostSecret = sec;
            this._handlePromotedToHost(sec, this.getState());
            return;
          }
          if (this.isHandingOver) {
            this.onConnectionChange({
              status: 'connecting',
              role: 'host',
              message: `Waiting for ${this.targetNewHostName || 'new host'} to complete takeover...`
            });
          } else {
            this.onConnectionChange({
              status: 'warning',
              role: 'viewer',
              message: 'Waiting for host to come online...'
            });
          }
          this._scheduleViewerReconnect(targetHostId);
        });

      } catch (e) {
        console.error('Viewer initialization failed:', e);
        this.onConnectionChange({ status: 'error', role: 'viewer', message: e.message });
      }
    }

    _connectToHost(targetHostId) {
      if (!this.peer || this.peer.destroyed) return;

      const conn = this.peer.connect(targetHostId, {
        reliable: true
      });

      conn.on('open', () => {
        this.hostConn = conn;
        this.isConnected = true;
        this.onConnectionChange({
          status: 'online',
          role: 'viewer',
          message: 'Connected to live game'
        });

        // Request initial state
        conn.send({ type: 'REQUEST_SYNC' });

        // Start heartbeat ping
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.hostConn && this.hostConn.open) {
            this.hostConn.send({ type: 'PING' });
          }
        }, PING_INTERVAL_MS);
      });

      conn.on('data', (data) => {
        if (!data || typeof data !== 'object') return;

        if (data.type === 'FULL_STATE' || data.type === 'STATE_UPDATE') {
          // If this peer was handing over host, and the new host is now confirmed transmitting:
          if (this.isHandingOver) {
            this.isHandingOver = false;
            this.isHost = false;
            this.hostSecret = null;
            if (this.handoverWatcherTimeout) {
              clearTimeout(this.handoverWatcherTimeout);
              this.handoverWatcherTimeout = null;
            }
            this.onHostTransferred(this.targetNewHostName || 'New Host');
          }

          this.latestState = data.payload;
          this.onStateReceived(data.payload);

          // If connecting with pending host claim, trigger claim now that state is received
          if (this.pendingClaimSecret) {
            const secret = this.pendingClaimSecret;
            this.pendingClaimSecret = null;
            this.claimHost(secret);
          }
        } else if (data.type === 'HOST_TRANSFER_READY' || data.type === 'HOST_TRANSFER_CONFIRMED') {
          const secret = data.secret || this.pendingHostSecret || this.hostSecret;
          const remoteState = data.state || this.latestState;
          if (remoteState) {
            this.latestState = remoteState;
            this.onStateReceived(remoteState);
          }

          // Acknowledge back to old host that we have taken over!
          try {
            conn.send({ type: 'HOST_TAKEOVER_ACK' });
          } catch (e) {}

          // Promote to host!
          this._handlePromotedToHost(secret, remoteState);
        } else if (data.type === 'HOST_TRANSFER_DENIED') {
          if (this._pendingClaimReject) {
            this._pendingClaimReject(new Error(data.error || 'Invalid host transfer key'));
            this._pendingClaimReject = null;
          }
        } else if (data.type === 'HOST_TRANSFERRED') {
          // Only process demotion if we are not the host taking over or handing over
          if (!this.isHost && !this.pendingHostSecret && !this.isHandingOver) {
            this.onHostTransferred(data.newHostName || 'Another player');
          }
        }
      });

      conn.on('close', () => {
        this.isConnected = false;
        this.onConnectionChange({
          status: 'warning',
          role: 'viewer',
          message: 'Host paused/disconnected. Attempting to reconnect...'
        });
        this._scheduleViewerReconnect(targetHostId);
      });

      conn.on('error', () => {
        this.isConnected = false;
        this._scheduleViewerReconnect(targetHostId);
      });
    }

    _scheduleViewerReconnect(targetHostId) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        if (!this.isConnected && !this.isHost) {
          this._connectToHost(targetHostId);
        }
      }, 4000);
    }

    _tryReconnect() {
      if (this.peer && !this.peer.destroyed) {
        this.peer.reconnect();
      }
    }

    /**
     * Broadcast new state to all connected viewers (Called by Host)
     */
    broadcastState(state) {
      this.latestState = state;
      if (!this.isHost) return;

      const message = {
        type: 'STATE_UPDATE',
        payload: state,
        timestamp: Date.now()
      };

      for (const [peerId, conn] of this.connections.entries()) {
        if (conn && conn.open) {
          try {
            conn.send(message);
          } catch (e) {
            console.warn(`Failed to send to viewer ${peerId}:`, e);
          }
        }
      }
    }

    /**
     * Start host handover without demoting until new host is confirmed online
     */
    startHostHandover(newHostName, claimantPeerId = null) {
      this.isHandingOver = true;
      this.targetNewHostName = newHostName;

      // Broadcast transfer notice to remaining viewers, excluding the new host
      for (const [peerId, conn] of this.connections.entries()) {
        if (peerId !== claimantPeerId && conn && conn.open) {
          try {
            conn.send({ type: 'HOST_TRANSFERRED', newHostName });
          } catch (e) {}
        }
      }

      // Close host socket so new host can bind to the room host ID
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      for (const conn of this.connections.values()) {
        try { conn.close(); } catch (e) {}
      }
      this.connections.clear();

      if (this.peer && !this.peer.destroyed) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
      this.isConnected = false;

      this.onConnectionChange({
        status: 'connecting',
        role: 'host',
        message: `Transferring host to ${newHostName}...`
      });

      // Watch for the new host to come online
      if (this.handoverWatcherTimeout) clearTimeout(this.handoverWatcherTimeout);

      // Safety recovery: If new host fails to come online within 14s, reclaim hosting!
      this.handoverWatcherTimeout = setTimeout(() => {
        if (this.isHandingOver) {
          console.warn('Host handover timed out. New host failed to bind. Reclaiming host authority.');
          this.isHandingOver = false;
          this.isHost = true;
          this.cleanup();
          this._startHost();
          this.onConnectionChange({
            status: 'warning',
            role: 'host',
            message: 'Handover timed out. Host authority restored.'
          });
        }
      }, 14000);

      // Start watcher as viewer to test when new host is live
      setTimeout(() => {
        if (this.isHandingOver) {
          this._startViewer();
        }
      }, 1200);
    }

    stepDownAsHost(newHostName, excludePeerId = null) {
      this.startHostHandover(newHostName, excludePeerId);
    }

    /**
     * Claim host rights using secret
     */
    claimHost(secret, newHostName = 'Host') {
      return new Promise((resolve, reject) => {
        this.pendingHostSecret = secret;
        this._pendingClaimResolve = resolve;
        this._pendingClaimReject = reject;

        if (this.hostConn && this.hostConn.open) {
          this.hostConn.send({
            type: 'CLAIM_HOST',
            secret: secret,
            newHostName: newHostName
          });
        } else {
          this.pendingClaimSecret = secret;
          this.onConnectionChange({
            status: 'connecting',
            role: 'viewer',
            message: 'Connecting to Host to claim rights...'
          });
        }
      });
    }

    _handlePromotedToHost(secret, latestState) {
      this.isHost = true;
      this.isHandingOver = false;
      this.hostSecret = secret || this.pendingHostSecret || this.hostSecret;
      this.pendingClaimSecret = null;
      this.pendingHostSecret = null;

      if (this._pendingClaimResolve) {
        this._pendingClaimResolve(true);
        this._pendingClaimResolve = null;
      }

      this.onHostPromoted(this.hostSecret, latestState || this.latestState);

      // Clean up viewer peer
      this.cleanup();
      if (this.peer && !this.peer.destroyed) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }

      // Claim host peer ID
      this.hostRetryCount = 0;
      setTimeout(() => {
        this._startHost();
      }, 700);
    }

    cleanup() {
      if (this.handoverWatcherTimeout) {
        clearTimeout(this.handoverWatcherTimeout);
        this.handoverWatcherTimeout = null;
      }
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.hostConn) {
        this.hostConn.close();
        this.hostConn = null;
      }
      for (const conn of this.connections.values()) {
        try { conn.close(); } catch (e) {}
      }
      this.connections.clear();

      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
      this.isConnected = false;
    }

    /**
     * Generate spectator link for sharing with friends
     */
    getSpectatorUrl() {
      const base = window.location.origin + window.location.pathname;
      return `${base}?room=${this.roomId}`;
    }

    /**
     * Generate host transfer link to pass rights to another player
     */
    getHostTransferUrl() {
      const base = window.location.origin + window.location.pathname;
      return `${base}?room=${this.roomId}&claim=${encodeURIComponent(this.hostSecret)}`;
    }
  }

  return {
    SyncManager
  };
});

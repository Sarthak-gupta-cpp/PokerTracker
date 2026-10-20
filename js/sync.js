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
      this.onConnectionChange = options.onConnectionChange || (() => {});
      this.onViewerCountChange = options.onViewerCountChange || (() => {});

      this.peer = null;
      this.roomId = null;
      this.hostSecret = null;
      this.isHost = false;
      this.connections = new Map(); // For host: Map of peerId -> DataConnection
      this.hostConn = null; // For viewer: DataConnection to host
      this.isConnected = false;
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
    init({ roomId, hostSecret, isHost, stateProvider }) {
      this.roomId = roomId;
      this.hostSecret = hostSecret;
      this.isHost = isHost;
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
          this.onConnectionChange({
            status: 'online',
            role: 'host',
            message: 'Live hosting active',
            peerId: id
          });
        });

        this.peer.on('connection', (conn) => {
          this._handleViewerConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.error('Host Peer error:', err);
          if (err.type === 'unavailable-id') {
            // Another tab or host might be running with this ID
            this.onConnectionChange({
              status: 'warning',
              role: 'host',
              message: 'Host ID already in use. If running in another tab, close it.'
            });
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
            conn.send({ type: 'HOST_TRANSFER_CONFIRMED', success: true });
            this.stepDownAsHost(data.newHostName);
          } else {
            conn.send({ type: 'HOST_TRANSFER_DENIED', error: 'Invalid secret key' });
          }
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
          this.onConnectionChange({
            status: 'warning',
            role: 'viewer',
            message: 'Waiting for host to come online...'
          });
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
          this.latestState = data.payload;
          this.onStateReceived(data.payload);
        } else if (data.type === 'HOST_TRANSFERRED') {
          this.onHostTransferred(data.newHostName || 'Another player');
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
     * Step down as host when rights are transferred
     */
    stepDownAsHost(newHostName) {
      this.isHost = false;
      // Broadcast transfer notice to remaining viewers
      for (const conn of this.connections.values()) {
        if (conn && conn.open) {
          conn.send({ type: 'HOST_TRANSFERRED', newHostName });
        }
      }

      this.cleanup();
      this.onHostTransferred(newHostName);
      // Restart as viewer
      this._startViewer();
    }

    /**
     * Claim host rights using secret
     */
    claimHost(secret, newHostName = 'Host') {
      return new Promise((resolve, reject) => {
        if (secret !== this.hostSecret) {
          return reject(new Error('Invalid host transfer key'));
        }

        // Promote to host
        this.isHost = true;
        this.cleanup();
        this._startHost();
        resolve(true);
      });
    }

    cleanup() {
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

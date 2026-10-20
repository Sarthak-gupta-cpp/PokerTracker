/**
 * PokerTracker - Main Application Controller
 * Manages game state, player ledger, UI interactions, sound effects, and P2P live sync.
 */

(function () {
  'use strict';

  // Storage Keys
  const STORAGE_KEY_GAME = 'pokertracker_game_state_v1';
  const STORAGE_KEY_RECENT = 'pokertracker_recent_players';
  const STORAGE_KEY_SETTINGS = 'pokertracker_user_settings';

  // Application State
  let state = {
    roomId: null,
    hostSecret: null,
    isHost: true,
    title: 'Tuesday Night Poker',
    date: '',
    currency: '₹',
    defaultBuyin: 200,
    soundEnabled: true,
    players: [],
    status: 'active', // 'active' | 'ended'
    settlementSummary: '',
    lastUpdated: Date.now()
  };

  // Active sync manager instance
  let syncManager = null;
  let qrcodeInstance = null;

  // Selected player for modals
  let activeModalPlayerId = null;

  // Audio Context for chip & chime sounds
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
  }

  function playChipSound() {
    if (!state.soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(350, audioCtx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  function playChimeSound() {
    if (!state.soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.1);

        gain.gain.setValueAtTime(0.2, audioCtx.currentTime + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.1 + 0.35);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(audioCtx.currentTime + idx * 0.1);
        osc.stop(audioCtx.currentTime + idx * 0.1 + 0.35);
      });
    } catch (e) {}
  }

  // =========================================================================
  // DOM Elements
  // =========================================================================
  const dom = {
    brandLink: document.getElementById('brandLink'),
    syncDot: document.getElementById('syncDot'),
    syncStatusText: document.getElementById('syncStatusText'),
    roomCodeBadge: document.getElementById('roomCodeBadge'),
    spectatorBanner: document.getElementById('spectatorBanner'),
    btnClaimHostPrompt: document.getElementById('btnClaimHostPrompt'),
    
    // Hero & Stats
    gameTitleInput: document.getElementById('gameTitleInput'),
    gameDateText: document.getElementById('gameDateText'),
    totalPotValue: document.getElementById('totalPotValue'),
    potSubtext: document.getElementById('potSubtext'),
    defaultBuyinValue: document.getElementById('defaultBuyinValue'),
    btnEditDefaultBuyin: document.getElementById('btnEditDefaultBuyin'),
    activePlayersCount: document.getElementById('activePlayersCount'),
    clockedOutSummarySubtext: document.getElementById('clockedOutSummarySubtext'),
    avgBuyinValue: document.getElementById('avgBuyinValue'),
    bottomBarPot: document.getElementById('bottomBarPot'),
    viewerBottomNotice: document.getElementById('viewerBottomNotice'),

    // Add Player Section
    addPlayerSection: document.getElementById('addPlayerSection'),
    addPlayerForm: document.getElementById('addPlayerForm'),
    playerNameInput: document.getElementById('playerNameInput'),
    quickSuggestionsWrap: document.getElementById('quickSuggestionsWrap'),
    suggestionsList: document.getElementById('suggestionsList'),

    // Players Grid
    playersGrid: document.getElementById('playersGrid'),
    emptyPlayersState: document.getElementById('emptyPlayersState'),
    playerTotalBadge: document.getElementById('playerTotalBadge'),

    // Header buttons
    btnShareLive: document.getElementById('btnShareLive'),
    btnTransferHost: document.getElementById('btnTransferHost'),
    btnSettings: document.getElementById('btnSettings'),
    btnNewGame: document.getElementById('btnNewGame'),
    btnEndGame: document.getElementById('btnEndGame'),

    // Modals
    modalCustomBuyin: document.getElementById('modalCustomBuyin'),
    customBuyinPlayerName: document.getElementById('customBuyinPlayerName'),
    customBuyinAmount: document.getElementById('customBuyinAmount'),
    btnConfirmCustomBuyin: document.getElementById('btnConfirmCustomBuyin'),

    modalClockOut: document.getElementById('modalClockOut'),
    clockOutPlayerName: document.getElementById('clockOutPlayerName'),
    clockOutTotalBuyin: document.getElementById('clockOutTotalBuyin'),
    clockOutCashCount: document.getElementById('clockOutCashCount'),
    btnClockOutBusted: document.getElementById('btnClockOutBusted'),
    clockOutNetValue: document.getElementById('clockOutNetValue'),
    btnConfirmClockOut: document.getElementById('btnConfirmClockOut'),

    modalEndGame: document.getElementById('modalEndGame'),
    endGameStage1: document.getElementById('endGameStage1'),
    endGameStage2: document.getElementById('endGameStage2'),
    reconcilePot: document.getElementById('reconcilePot'),
    reconcileStatusText: document.getElementById('reconcileStatusText'),
    reconcileBox: document.getElementById('reconcileBox'),
    endGamePlayersList: document.getElementById('endGamePlayersList'),
    btnCalculateSettlement: document.getElementById('btnCalculateSettlement'),
    btnEndGameBack: document.getElementById('btnEndGameBack'),
    finalSummaryText: document.getElementById('finalSummaryText'),
    btnCopySummary: document.getElementById('btnCopySummary'),
    btnShareWhatsApp: document.getElementById('btnShareWhatsApp'),

    modalShare: document.getElementById('modalShare'),
    tabSpectator: document.getElementById('tabSpectator'),
    tabTransfer: document.getElementById('tabTransfer'),
    tabContentSpectator: document.getElementById('tabContentSpectator'),
    tabContentTransfer: document.getElementById('tabContentTransfer'),
    spectatorLinkInput: document.getElementById('spectatorLinkInput'),
    btnCopySpectatorLink: document.getElementById('btnCopySpectatorLink'),
    qrcodeWrapper: document.getElementById('qrcodeWrapper'),
    hostTransferLinkInput: document.getElementById('hostTransferLinkInput'),
    btnCopyHostTransferLink: document.getElementById('btnCopyHostTransferLink'),
    transferPlayersList: document.getElementById('transferPlayersList'),

    modalSettings: document.getElementById('modalSettings'),
    settingCurrencyInput: document.getElementById('settingCurrencyInput'),
    settingDefaultBuyinInput: document.getElementById('settingDefaultBuyinInput'),
    settingSoundToggle: document.getElementById('settingSoundToggle'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),

    toastContainer: document.getElementById('toastContainer')
  };

  // =========================================================================
  // Initialization & URL Routing
  // =========================================================================
  function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const claimParam = urlParams.get('claim');

    // Load saved settings if any
    try {
      const savedSettings = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{}');
      if (savedSettings.currency) state.currency = savedSettings.currency;
      if (savedSettings.defaultBuyin) state.defaultBuyin = Number(savedSettings.defaultBuyin);
      if (typeof savedSettings.soundEnabled === 'boolean') state.soundEnabled = savedSettings.soundEnabled;
    } catch (e) {}

    // Set default date formatted (e.g. "Tuesday, Oct 20")
    const now = new Date();
    state.date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    state.title = `${now.toLocaleDateString('en-US', { weekday: 'long' })} Night Poker`;

    let savedGame = null;
    try {
      savedGame = JSON.parse(localStorage.getItem(STORAGE_KEY_GAME) || 'null');
    } catch (e) {}

    if (roomParam) {
      // Joined via Room Link
      state.roomId = roomParam.toUpperCase();
      const storedSecret = localStorage.getItem(`pokertracker_secret_${state.roomId}`);

      if (claimParam) {
        // Player opened a Host Transfer link!
        state.hostSecret = claimParam;
        state.isHost = true;
        localStorage.setItem(`pokertracker_secret_${state.roomId}`, claimParam);
        showToast('👑 You claimed Host authority for this game!', 'success');
        // Clean URL to prevent accidental re-claim
        window.history.replaceState({}, '', `${window.location.pathname}?room=${state.roomId}`);
      } else if (storedSecret) {
        // We are already the host of this room
        state.hostSecret = storedSecret;
        state.isHost = true;
      } else {
        // Viewer mode
        state.isHost = false;
        state.hostSecret = null;
      }

      if (savedGame && savedGame.roomId === state.roomId) {
        state = { ...state, ...savedGame, isHost: state.isHost };
      }
    } else {
      // No room in URL: resume last hosted game or create new
      if (savedGame && savedGame.roomId && savedGame.isHost) {
        state = { ...state, ...savedGame };
      } else {
        createNewGame();
      }
    }

    // Initialize P2P Live Sync
    initSync();

    // Render Initial UI
    render();
    renderRecentSuggestions();
    bindEvents();
  }

  function createNewGame() {
    state.roomId = PokerSync.SyncManager.generateRoomId();
    state.hostSecret = PokerSync.SyncManager.generateSecret();
    state.isHost = true;
    state.players = [];
    state.status = 'active';
    state.settlementSummary = '';
    const now = new Date();
    state.date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    state.title = `${now.toLocaleDateString('en-US', { weekday: 'long' })} Night Poker`;

    localStorage.setItem(`pokertracker_secret_${state.roomId}`, state.hostSecret);
    saveState();
  }

  function initSync() {
    if (syncManager) syncManager.cleanup();

    syncManager = new PokerSync.SyncManager({
      onStateReceived: (remoteState) => {
        if (!state.isHost) {
          // Viewers sync to host state
          state = {
            ...remoteState,
            isHost: false, // viewer stays viewer
            roomId: state.roomId
          };
          render();
        }
      },
      onHostTransferred: (newHostName) => {
        showToast(`👑 Host rights transferred to ${newHostName}!`, 'warning');
        state.isHost = false;
        render();
      },
      onConnectionChange: ({ status, role, message }) => {
        updateSyncStatusUI(status, message);
      },
      onViewerCountChange: (count) => {
        if (state.isHost && count > 0) {
          dom.syncStatusText.textContent = `Hosting (${count} viewer${count > 1 ? 's' : ''})`;
        }
      }
    });

    syncManager.init({
      roomId: state.roomId,
      hostSecret: state.hostSecret,
      isHost: state.isHost,
      stateProvider: () => state
    });
  }

  function updateSyncStatusUI(status, message) {
    dom.syncDot.className = 'status-dot';
    if (status === 'online') {
      dom.syncDot.classList.remove('dot-warning', 'dot-offline');
      dom.syncStatusText.textContent = state.isHost ? 'Live Hosting' : 'Live Synced';
    } else if (status === 'connecting' || status === 'warning') {
      dom.syncDot.classList.add('dot-warning');
      dom.syncStatusText.textContent = message || 'Connecting...';
    } else {
      dom.syncDot.classList.add('dot-offline');
      dom.syncStatusText.textContent = 'Offline';
    }

    dom.roomCodeBadge.textContent = `#${state.roomId}`;
  }

  function saveState() {
    state.lastUpdated = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY_GAME, JSON.stringify(state));
    } catch (e) {}

    // Broadcast to viewers if host
    if (state.isHost && syncManager) {
      syncManager.broadcastState(state);
    }
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  function render() {
    // 1. Host vs Spectator Mode UI adjustments
    document.querySelectorAll('.host-only-control').forEach(el => {
      el.style.display = state.isHost ? '' : 'none';
    });

    if (state.isHost) {
      dom.spectatorBanner.classList.remove('active');
      dom.viewerBottomNotice.style.display = 'none';
      dom.btnEndGame.style.display = '';
      dom.gameTitleInput.removeAttribute('readonly');
    } else {
      dom.spectatorBanner.classList.add('active');
      dom.viewerBottomNotice.style.display = 'block';
      dom.btnEndGame.style.display = 'none';
      dom.gameTitleInput.setAttribute('readonly', 'true');
    }

    // 2. Titles & Badges
    dom.gameTitleInput.value = state.title;
    dom.gameDateText.textContent = state.date;
    dom.defaultBuyinValue.textContent = `${state.currency}${state.defaultBuyin}`;

    // 3. Stats Calculation
    let totalPot = 0;
    let totalBuyinCount = 0;
    let clockedOutCount = 0;

    state.players.forEach(p => {
      const playerBuyinSum = (p.buyIns || []).reduce((sum, b) => sum + (Number(b) || 0), 0);
      totalPot += playerBuyinSum;
      totalBuyinCount += (p.buyIns || []).length;
      if (p.clockedOut) clockedOutCount++;
    });

    const activeCount = state.players.length - clockedOutCount;
    const avgBuyin = activeCount > 0 ? Math.round(totalPot / state.players.length) : 0;

    dom.totalPotValue.textContent = `${state.currency}${totalPot.toLocaleString()}`;
    dom.bottomBarPot.textContent = `${state.currency}${totalPot.toLocaleString()}`;
    dom.potSubtext.textContent = `${totalBuyinCount} total buy-in${totalBuyinCount === 1 ? '' : 's'}`;
    dom.activePlayersCount.textContent = `${activeCount} / ${state.players.length}`;
    dom.clockedOutSummarySubtext.textContent = `${clockedOutCount} clocked out`;
    dom.avgBuyinValue.textContent = `${state.currency}${avgBuyin.toLocaleString()}`;
    dom.playerTotalBadge.textContent = state.players.length;

    // 4. Render Player Cards
    dom.playersGrid.innerHTML = '';
    if (state.players.length === 0) {
      dom.emptyPlayersState.style.display = 'block';
    } else {
      dom.emptyPlayersState.style.display = 'none';
      state.players.forEach(player => {
        const card = createPlayerCardElement(player);
        dom.playersGrid.appendChild(card);
      });
    }

    // Update settings inputs
    dom.settingCurrencyInput.value = state.currency;
    dom.settingDefaultBuyinInput.value = state.defaultBuyin;
    dom.settingSoundToggle.checked = state.soundEnabled;
  }

  function createPlayerCardElement(player) {
    const card = document.createElement('div');
    card.className = `player-card ${player.clockedOut ? 'is-clocked-out' : ''}`;
    card.id = `card-${player.id}`;

    const totalBuyin = (player.buyIns || []).reduce((sum, b) => sum + (Number(b) || 0), 0);
    const buyinCount = (player.buyIns || []).length;
    const initial = (player.name || '?').charAt(0).toUpperCase();

    // Suit icon based on player ID hash
    const suits = ['♠', '♥', '♦', '♣'];
    const suit = suits[Math.abs(player.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 4];

    // Card Header
    let statusBadgeHtml = '';
    if (player.clockedOut) {
      statusBadgeHtml = `<div class="player-clocked-badge">⏱️ Clocked Out</div>`;
    }

    // Menu options for host
    let menuBtnHtml = '';
    if (state.isHost) {
      menuBtnHtml = `
        <button class="btn btn-ghost btn-sm btn-icon btn-remove-player" data-id="${player.id}" title="Remove Player">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `;
    }

    // Chips Pills
    let chipsHtml = '';
    (player.buyIns || []).forEach((b, idx) => {
      chipsHtml += `
        <span class="buyin-chip">
          <span>${state.currency}${Number(b).toLocaleString()}</span>
          ${state.isHost ? `<button class="buyin-chip-remove" data-player-id="${player.id}" data-chip-idx="${idx}" title="Remove this buy-in">×</button>` : ''}
        </span>
      `;
    });

    // Body content: Active vs Clocked Out
    let bodyHtml = '';
    let footerHtml = '';

    if (player.clockedOut) {
      const net = Math.round(((Number(player.cashOut) || 0) - totalBuyin) * 100) / 100;
      let netClass = 'net-zero';
      let netStr = `${state.currency}0`;
      if (net > 0) {
        netClass = 'net-positive';
        netStr = `+${state.currency}${net.toLocaleString()}`;
      } else if (net < 0) {
        netClass = 'net-negative';
        netStr = `−${state.currency}${Math.abs(net).toLocaleString()}`;
      }

      bodyHtml = `
        <div class="clocked-out-summary">
          <div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase;">Cashed Out</div>
            <div style="font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; color: #FFFFFF;">
              ${state.currency}${Number(player.cashOut || 0).toLocaleString()}
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">From ${state.currency}${totalBuyin.toLocaleString()} bought in</div>
          </div>
          <div class="clockout-net-badge ${netClass}">${netStr}</div>
        </div>
      `;

      if (state.isHost) {
        footerHtml = `
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-secondary btn-sm btn-reopen-clockout" data-id="${player.id}" style="flex: 1;">
              Edit Cash-out
            </button>
            <button class="btn btn-ghost btn-sm btn-rejoin-game" data-id="${player.id}" style="color: var(--color-emerald-light);">
              Rejoin
            </button>
          </div>
        `;
      }
    } else {
      bodyHtml = `
        <div class="player-card-body">
          <div>
            <div class="total-in-label">Total In</div>
            <div class="total-in-amount tabular">${state.currency}${totalBuyin.toLocaleString()}</div>
          </div>
          <div class="buyin-count-badge">${buyinCount} buy-in${buyinCount === 1 ? '' : 's'}</div>
        </div>
        ${chipsHtml ? `<div class="buyin-chips-row">${chipsHtml}</div>` : ''}
      `;

      if (state.isHost) {
        footerHtml = `
          <div class="player-card-actions">
            <button class="btn btn-buyin-quick btn-quick-rebuy" data-id="${player.id}" title="Add default ${state.currency}${state.defaultBuyin}">
              +${state.currency}${state.defaultBuyin}
            </button>
            <button class="btn btn-buyin-custom btn-open-custom-buyin" data-id="${player.id}">
              +Custom
            </button>
            <button class="btn btn-clockout btn-open-clockout" data-id="${player.id}" title="Clock out with final chips">
              Clock Out
            </button>
          </div>
        `;
      }
    }

    card.innerHTML = `
      <div class="player-card-header">
        <div class="player-info">
          <div class="player-avatar" title="${suit}">${initial}</div>
          <div class="player-name-wrap">
            <div class="player-name">${escapeHtml(player.name)}</div>
            ${statusBadgeHtml}
          </div>
        </div>
        <div class="player-actions-menu">
          ${menuBtnHtml}
        </div>
      </div>
      ${bodyHtml}
      ${footerHtml}
    `;

    return card;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // =========================================================================
  // Player Actions (Add, Buy-in, Rebuy, Clock-out)
  // =========================================================================
  function addPlayer(name) {
    name = (name || '').trim();
    if (!name) return;

    // Check duplicate
    const exists = state.players.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      showToast(`Player "${name}" is already in the game!`, 'warning');
      return;
    }

    const newPlayer = {
      id: 'p_' + Math.random().toString(36).substring(2, 9),
      name,
      buyIns: [state.defaultBuyin], // Start with 1 default buy-in immediately
      clockedOut: false,
      cashOut: null,
      clockOutTime: null
    };

    state.players.push(newPlayer);
    rememberPlayerName(name);
    playChipSound();
    saveState();
    render();
    renderRecentSuggestions();

    showToast(`Added ${name} with initial ${state.currency}${state.defaultBuyin} buy-in`, 'success');
  }

  function addQuickBuyin(playerId) {
    const player = state.players.find(p => p.id === playerId);
    if (!player || player.clockedOut) return;

    player.buyIns = player.buyIns || [];
    player.buyIns.push(state.defaultBuyin);

    playChipSound();
    saveState();
    render();

    // Trigger pop animation on card
    const card = document.getElementById(`card-${playerId}`);
    if (card) {
      card.classList.remove('animate-pop');
      void card.offsetWidth;
      card.classList.add('animate-pop');
    }

    showToast(`+${state.currency}${state.defaultBuyin} added to ${player.name}`, 'success');
  }

  function addCustomBuyin(playerId, amount) {
    const player = state.players.find(p => p.id === playerId);
    if (!player || player.clockedOut) return;

    amount = Number(amount);
    if (!amount || amount <= 0) return;

    player.buyIns = player.buyIns || [];
    player.buyIns.push(amount);

    playChipSound();
    saveState();
    render();
    closeModal(dom.modalCustomBuyin);

    showToast(`+${state.currency}${amount} custom buy-in added to ${player.name}`, 'success');
  }

  function removeBuyinChip(playerId, chipIndex) {
    const player = state.players.find(p => p.id === playerId);
    if (!player || !player.buyIns || !player.buyIns[chipIndex]) return;

    const removedAmount = player.buyIns.splice(chipIndex, 1)[0];
    saveState();
    render();
    showToast(`Removed ${state.currency}${removedAmount} buy-in for ${player.name}`, 'warning');
  }

  function clockOutPlayer(playerId, cashOutAmount) {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    cashOutAmount = Number(cashOutAmount) || 0;
    player.clockedOut = true;
    player.cashOut = cashOutAmount;
    player.clockOutTime = Date.now();

    playChipSound();
    saveState();
    render();
    closeModal(dom.modalClockOut);

    const totalBuyin = (player.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
    const net = cashOutAmount - totalBuyin;
    const netStr = net >= 0 ? `+${state.currency}${net}` : `−${state.currency}${Math.abs(net)}`;

    showToast(`${player.name} clocked out with ${state.currency}${cashOutAmount} (${netStr})`, 'success');
  }

  function rejoinGame(playerId) {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    player.clockedOut = false;
    player.cashOut = null;
    player.clockOutTime = null;

    saveState();
    render();
    showToast(`${player.name} has rejoined the active game!`, 'success');
  }

  function removePlayer(playerId) {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    if (confirm(`Are you sure you want to remove "${player.name}" from the game?`)) {
      state.players = state.players.filter(p => p.id !== playerId);
      saveState();
      render();
      showToast(`Removed ${player.name}`, 'warning');
    }
  }

  // =========================================================================
  // End Game & Settlement Workflow
  // =========================================================================
  function openEndGameModal() {
    if (state.players.length === 0) {
      showToast('Add players to the game first!', 'warning');
      return;
    }

    // Reset view to Stage 1
    dom.endGameStage1.style.display = 'block';
    dom.endGameStage2.style.display = 'none';
    dom.btnEndGameBack.style.display = 'none';
    dom.btnCalculateSettlement.style.display = '';

    // Calculate total pot
    let totalPot = 0;
    state.players.forEach(p => {
      totalPot += (p.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
    });
    dom.reconcilePot.textContent = `${state.currency}${totalPot.toLocaleString()}`;

    // Render Stage 1 input rows for all active (non-clocked-out) players
    dom.endGamePlayersList.innerHTML = '';
    const activePlayers = state.players.filter(p => !p.clockedOut);

    if (activePlayers.length === 0) {
      dom.endGamePlayersList.innerHTML = `
        <div style="padding: 1rem; text-align: center; color: var(--text-muted);">
          All players have already clocked out! Click calculate below to see final standings.
        </div>
      `;
    } else {
      activePlayers.forEach(p => {
        const totalBuyIn = (p.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
        const row = document.createElement('div');
        row.className = 'end-game-player-row';
        row.innerHTML = `
          <div class="end-game-player-info">
            <div class="end-game-player-name">${escapeHtml(p.name)}</div>
            <div class="end-game-player-buyin">Bought in: ${state.currency}${totalBuyIn.toLocaleString()}</div>
          </div>
          <div class="end-game-input-group">
            <input type="number" class="input-count end-game-count-input" data-player-id="${p.id}" placeholder="0" min="0" step="any" value="${p.cashOut !== null ? p.cashOut : ''}">
            <button type="button" class="btn btn-secondary btn-sm btn-zero-count" data-player-id="${p.id}">Busted (0)</button>
          </div>
        `;
        dom.endGamePlayersList.appendChild(row);
      });
    }

    // Attach real-time input change listeners for balance tally
    dom.endGamePlayersList.querySelectorAll('.end-game-count-input').forEach(inp => {
      inp.addEventListener('input', updateReconcileTally);
    });

    dom.endGamePlayersList.querySelectorAll('.btn-zero-count').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pId = e.currentTarget.dataset.playerId;
        const targetInput = dom.endGamePlayersList.querySelector(`.end-game-count-input[data-player-id="${pId}"]`);
        if (targetInput) {
          targetInput.value = '0';
          updateReconcileTally();
        }
      });
    });

    updateReconcileTally();
    openModal(dom.modalEndGame);
  }

  function updateReconcileTally() {
    let totalPot = 0;
    let totalCounted = 0;

    // Sum clocked out cash-outs
    state.players.forEach(p => {
      totalPot += (p.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
      if (p.clockedOut) {
        totalCounted += Number(p.cashOut) || 0;
      }
    });

    // Sum stage 1 input fields
    dom.endGamePlayersList.querySelectorAll('.end-game-count-input').forEach(inp => {
      totalCounted += Number(inp.value) || 0;
    });

    totalPot = Math.round(totalPot * 100) / 100;
    totalCounted = Math.round(totalCounted * 100) / 100;
    const diff = Math.round((totalCounted - totalPot) * 100) / 100;

    if (Math.abs(diff) < 0.01) {
      dom.reconcileBox.classList.remove('has-error');
      dom.reconcileStatusText.className = 'reconcile-status status-ok';
      dom.reconcileStatusText.textContent = `✓ Perfectly Balanced (${state.currency}${totalCounted.toLocaleString()})`;
    } else if (diff > 0) {
      dom.reconcileBox.classList.add('has-error');
      dom.reconcileStatusText.className = 'reconcile-status status-error';
      dom.reconcileStatusText.textContent = `⚠️ +${state.currency}${diff.toLocaleString()} extra chips counted`;
    } else {
      dom.reconcileBox.classList.add('has-error');
      dom.reconcileStatusText.className = 'reconcile-status status-error';
      dom.reconcileStatusText.textContent = `⚠️ −${state.currency}${Math.abs(diff).toLocaleString()} chips missing`;
    }
  }

  function calculateAndDisplaySettlement() {
    // 1. Gather counts from inputs and update state
    dom.endGamePlayersList.querySelectorAll('.end-game-count-input').forEach(inp => {
      const pId = inp.dataset.playerId;
      const val = Number(inp.value) || 0;
      const player = state.players.find(p => p.id === pId);
      if (player && !player.clockedOut) {
        player.cashOut = val;
      }
    });

    // 2. Run Settlement Engine
    const leaderboard = PokerSettlement.calculateLeaderboard(state.players, state.currency);
    const transactions = PokerSettlement.calculateSettlement(leaderboard);

    // 3. Generate Live Game URL for the summary
    const gameUrl = syncManager ? syncManager.getSpectatorUrl() : window.location.href;

    const summaryText = PokerSettlement.generateSummaryText({
      gameTitle: state.title,
      gameDate: state.date,
      leaderboard,
      transactions,
      gameUrl,
      currency: state.currency
    });

    state.settlementSummary = summaryText;
    state.status = 'ended';
    saveState();

    // 4. Update Modal to Stage 2
    dom.finalSummaryText.textContent = summaryText;
    dom.endGameStage1.style.display = 'none';
    dom.endGameStage2.style.display = 'block';
    dom.btnEndGameBack.style.display = 'inline-flex';
    dom.btnCalculateSettlement.style.display = 'none';

    // 5. Celebration burst & Chime!
    playChimeSound();
    if (typeof confetti === 'function') {
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch (e) {}
    }
  }

  // =========================================================================
  // Recent Players Roster Persistence
  // =========================================================================
  function rememberPlayerName(name) {
    try {
      let recent = JSON.parse(localStorage.getItem(STORAGE_KEY_RECENT) || '[]');
      recent = recent.filter(n => n.toLowerCase() !== name.toLowerCase());
      recent.unshift(name);
      if (recent.length > 15) recent.pop();
      localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(recent));
    } catch (e) {}
  }

  function renderRecentSuggestions() {
    try {
      const recent = JSON.parse(localStorage.getItem(STORAGE_KEY_RECENT) || '[]');
      const activeNames = state.players.map(p => p.name.toLowerCase());
      const available = recent.filter(n => !activeNames.includes(n.toLowerCase())).slice(0, 8);

      if (available.length > 0) {
        dom.quickSuggestionsWrap.style.display = 'flex';
        dom.suggestionsList.innerHTML = available
          .map(n => `<button type="button" class="suggestion-chip" data-name="${escapeHtml(n)}">+ ${escapeHtml(n)}</button>`)
          .join('');
      } else {
        dom.quickSuggestionsWrap.style.display = 'none';
      }
    } catch (e) {
      dom.quickSuggestionsWrap.style.display = 'none';
    }
  }

  // =========================================================================
  // Share & Host Transfer Modal
  // =========================================================================
  function openShareModal(initialTab = 'spectator') {
    if (!syncManager) return;

    const spectatorUrl = syncManager.getSpectatorUrl();
    const hostTransferUrl = syncManager.getHostTransferUrl();

    dom.spectatorLinkInput.value = spectatorUrl;
    dom.hostTransferLinkInput.value = hostTransferUrl;

    // Generate QR Code for fast table scanning
    dom.qrcodeWrapper.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(dom.qrcodeWrapper, {
          text: spectatorUrl,
          width: 170,
          height: 170,
          colorDark: '#0B0F19',
          colorLight: '#FFFFFF',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        console.warn('QR Code generation error:', e);
      }
    }

    // Populate players list for direct host handoff
    dom.transferPlayersList.innerHTML = '';
    state.players.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-sm';
      btn.style.justifyContent = 'space-between';
      btn.innerHTML = `
        <span>Pass to <strong>${escapeHtml(p.name)}</strong></span>
        <span style="font-size: 0.72rem; color: var(--color-amber-light);">Copy Link</span>
      `;
      btn.addEventListener('click', () => {
        copyToClipboard(hostTransferUrl, `Host link for ${p.name} copied! Send it to them.`);
      });
      dom.transferPlayersList.appendChild(btn);
    });

    switchShareTab(initialTab);
    openModal(dom.modalShare);
  }

  function switchShareTab(tab) {
    if (tab === 'spectator') {
      dom.tabSpectator.classList.add('active');
      dom.tabTransfer.classList.remove('active');
      dom.tabContentSpectator.style.display = 'block';
      dom.tabContentTransfer.style.display = 'none';
    } else {
      dom.tabTransfer.classList.add('active');
      dom.tabSpectator.classList.remove('active');
      dom.tabContentTransfer.style.display = 'block';
      dom.tabContentSpectator.style.display = 'none';
    }
  }

  // =========================================================================
  // Toast & Modal Helpers
  // =========================================================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✓';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '✕';

    toast.innerHTML = `<span style="font-weight: 700;">${icon}</span><span>${escapeHtml(message)}</span>`;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, 3200);
  }

  function openModal(modalEl) {
    modalEl.classList.add('active');
  }

  function closeModal(modalEl) {
    modalEl.classList.remove('active');
  }

  function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg, 'success');
      }).catch(() => fallbackCopy(text, successMsg));
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(successMsg, 'success');
    } catch (e) {
      showToast('Could not auto-copy. Please select and copy manually.', 'warning');
    }
    ta.remove();
  }

  // =========================================================================
  // Event Bindings
  // =========================================================================
  function bindEvents() {
    // Game Title input
    dom.gameTitleInput.addEventListener('change', () => {
      state.title = dom.gameTitleInput.value.trim() || 'Poker Night';
      saveState();
    });

    // Add Player Form
    dom.addPlayerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addPlayer(dom.playerNameInput.value);
      dom.playerNameInput.value = '';
    });

    // Recent Suggestion click delegation
    dom.suggestionsList.addEventListener('click', (e) => {
      const chip = e.target.closest('.suggestion-chip');
      if (chip && chip.dataset.name) {
        addPlayer(chip.dataset.name);
      }
    });

    // Players Grid Action Delegation
    dom.playersGrid.addEventListener('click', (e) => {
      const rebuyBtn = e.target.closest('.btn-quick-rebuy');
      if (rebuyBtn) {
        addQuickBuyin(rebuyBtn.dataset.id);
        return;
      }

      const customBuyinBtn = e.target.closest('.btn-open-custom-buyin');
      if (customBuyinBtn) {
        activeModalPlayerId = customBuyinBtn.dataset.id;
        const player = state.players.find(p => p.id === activeModalPlayerId);
        if (player) {
          dom.customBuyinPlayerName.textContent = player.name;
          dom.customBuyinAmount.value = '';
          openModal(dom.modalCustomBuyin);
          setTimeout(() => dom.customBuyinAmount.focus(), 150);
        }
        return;
      }

      const clockOutBtn = e.target.closest('.btn-open-clockout');
      if (clockOutBtn) {
        activeModalPlayerId = clockOutBtn.dataset.id;
        const player = state.players.find(p => p.id === activeModalPlayerId);
        if (player) {
          dom.clockOutPlayerName.textContent = player.name;
          const totalBuyin = (player.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
          dom.clockOutTotalBuyin.textContent = `${state.currency}${totalBuyin.toLocaleString()}`;
          dom.clockOutCashCount.value = '';
          dom.clockOutNetValue.textContent = `${state.currency}0`;
          openModal(dom.modalClockOut);
          setTimeout(() => dom.clockOutCashCount.focus(), 150);
        }
        return;
      }

      const reopenClockoutBtn = e.target.closest('.btn-reopen-clockout');
      if (reopenClockoutBtn) {
        activeModalPlayerId = reopenClockoutBtn.dataset.id;
        const player = state.players.find(p => p.id === activeModalPlayerId);
        if (player) {
          dom.clockOutPlayerName.textContent = player.name;
          const totalBuyin = (player.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
          dom.clockOutTotalBuyin.textContent = `${state.currency}${totalBuyin.toLocaleString()}`;
          dom.clockOutCashCount.value = player.cashOut || 0;
          openModal(dom.modalClockOut);
        }
        return;
      }

      const rejoinBtn = e.target.closest('.btn-rejoin-game');
      if (rejoinBtn) {
        rejoinGame(rejoinBtn.dataset.id);
        return;
      }

      const removeChipBtn = e.target.closest('.buyin-chip-remove');
      if (removeChipBtn) {
        const pId = removeChipBtn.dataset.playerId;
        const cIdx = parseInt(removeChipBtn.dataset.chipIdx, 10);
        removeBuyinChip(pId, cIdx);
        return;
      }

      const removePlayerBtn = e.target.closest('.btn-remove-player');
      if (removePlayerBtn) {
        removePlayer(removePlayerBtn.dataset.id);
        return;
      }
    });

    // Custom Buyin Presets & Submit
    document.querySelectorAll('.quick-amount-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const amt = btn.dataset.amount;
        dom.customBuyinAmount.value = amt;
      });
    });

    dom.btnConfirmCustomBuyin.addEventListener('click', () => {
      if (activeModalPlayerId && dom.customBuyinAmount.value) {
        addCustomBuyin(activeModalPlayerId, dom.customBuyinAmount.value);
      }
    });

    dom.customBuyinAmount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        dom.btnConfirmCustomBuyin.click();
      }
    });

    // Clock Out Modal events
    dom.clockOutCashCount.addEventListener('input', () => {
      const player = state.players.find(p => p.id === activeModalPlayerId);
      if (!player) return;
      const totalBuyin = (player.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
      const cash = Number(dom.clockOutCashCount.value) || 0;
      const net = cash - totalBuyin;
      dom.clockOutNetValue.textContent = net >= 0 ? `+${state.currency}${net}` : `−${state.currency}${Math.abs(net)}`;
      dom.clockOutNetValue.style.color = net >= 0 ? 'var(--color-emerald-light)' : 'var(--color-rose-light)';
    });

    dom.btnClockOutBusted.addEventListener('click', () => {
      dom.clockOutCashCount.value = '0';
      dom.clockOutCashCount.dispatchEvent(new Event('input'));
    });

    dom.btnConfirmClockOut.addEventListener('click', () => {
      if (activeModalPlayerId) {
        clockOutPlayer(activeModalPlayerId, dom.clockOutCashCount.value);
      }
    });

    // Header buttons
    dom.btnShareLive.addEventListener('click', () => openShareModal('spectator'));
    dom.btnTransferHost.addEventListener('click', () => openShareModal('transfer'));
    dom.btnSettings.addEventListener('click', () => openModal(dom.modalSettings));

    dom.btnNewGame.addEventListener('click', () => {
      if (confirm('Start a new poker session? (Current session will be archived)')) {
        createNewGame();
        initSync();
        render();
        showToast('New game created!', 'success');
      }
    });

    dom.roomCodeBadge.addEventListener('click', () => {
      if (syncManager) {
        copyToClipboard(syncManager.getSpectatorUrl(), 'Spectator room link copied!');
      }
    });

    // Edit default buyin from stat card
    dom.btnEditDefaultBuyin.addEventListener('click', () => {
      const newAmt = prompt('Enter new default buy-in amount:', state.defaultBuyin);
      if (newAmt && !isNaN(newAmt) && Number(newAmt) > 0) {
        state.defaultBuyin = Number(newAmt);
        saveState();
        render();
        showToast(`Default buy-in updated to ${state.currency}${state.defaultBuyin}`, 'success');
      }
    });

    // End Game button
    dom.btnEndGame.addEventListener('click', openEndGameModal);
    dom.btnCalculateSettlement.addEventListener('click', calculateAndDisplaySettlement);
    dom.btnEndGameBack.addEventListener('click', () => {
      dom.endGameStage1.style.display = 'block';
      dom.endGameStage2.style.display = 'none';
      dom.btnEndGameBack.style.display = 'none';
      dom.btnCalculateSettlement.style.display = '';
    });

    // Copy Summary Text
    dom.btnCopySummary.addEventListener('click', () => {
      copyToClipboard(state.settlementSummary, '📋 Final summary copied! Paste it in WhatsApp.');
    });

    // WhatsApp Share
    dom.btnShareWhatsApp.addEventListener('click', () => {
      const url = `https://wa.me/?text=${encodeURIComponent(state.settlementSummary)}`;
      window.open(url, '_blank');
    });

    // Share Modal tabs & copies
    dom.tabSpectator.addEventListener('click', () => switchShareTab('spectator'));
    dom.tabTransfer.addEventListener('click', () => switchShareTab('transfer'));
    dom.btnCopySpectatorLink.addEventListener('click', () => {
      copyToClipboard(dom.spectatorLinkInput.value, 'Spectator link copied!');
    });
    dom.btnCopyHostTransferLink.addEventListener('click', () => {
      copyToClipboard(dom.hostTransferLinkInput.value, '👑 Host transfer link copied! Send to new host.');
    });

    // Spectator Banner Claim Host button
    dom.btnClaimHostPrompt.addEventListener('click', () => {
      const enteredSecret = prompt('Enter Host secret key to take over as host:');
      if (enteredSecret && syncManager) {
        syncManager.claimHost(enteredSecret.trim())
          .then(() => {
            state.isHost = true;
            state.hostSecret = enteredSecret.trim();
            localStorage.setItem(`pokertracker_secret_${state.roomId}`, state.hostSecret);
            render();
            showToast('👑 You are now the Host!', 'success');
          })
          .catch(err => {
            showToast(err.message, 'error');
          });
      }
    });

    // Settings save
    dom.btnSaveSettings.addEventListener('click', () => {
      state.currency = dom.settingCurrencyInput.value.trim() || '₹';
      state.defaultBuyin = Number(dom.settingDefaultBuyinInput.value) || 200;
      state.soundEnabled = dom.settingSoundToggle.checked;

      try {
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({
          currency: state.currency,
          defaultBuyin: state.defaultBuyin,
          soundEnabled: state.soundEnabled
        }));
      } catch (e) {}

      saveState();
      render();
      closeModal(dom.modalSettings);
      showToast('Settings saved!', 'success');
    });

    // Close Modals on backdrop or close button
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = btn.dataset.modal;
        if (modalId) {
          const m = document.getElementById(modalId);
          if (m) closeModal(m);
        }
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeModal(overlay);
        }
      });
    });

    // Escape key closes modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m));
      }
    });
  }

  // Launch on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

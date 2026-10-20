/**
 * PokerTracker - Main Application Controller
 * Manages Home Page, Usual Players Roster, Live Game Ledger, P2P Sync, and Audio.
 */

(function () {
  'use strict';

  // Storage Keys
  const STORAGE_KEY_GAMES = 'pokertracker_games_list_v1';
  const STORAGE_KEY_GAME = 'pokertracker_game_state_v1';
  const STORAGE_KEY_USUAL = 'pokertracker_usual_players_v1';
  const STORAGE_KEY_SETTINGS = 'pokertracker_user_settings';

  // Default Usual Players sample for first-time poker hosts
  const DEFAULT_SAMPLE_PLAYERS = ['Sam', 'Vidit', 'Kalash', 'Megh', 'Aarav', 'Ishaan', 'Adit'];

  // Current Active View
  let currentView = 'home'; // 'home' | 'game'

  // Get time of day based on hour: morning (4-12), afternoon (12-4), evening (4-8), night (8-4)
  function getTimeOfDay(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 4 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 16) return 'Afternoon';
    if (hour >= 16 && hour < 20) return 'Evening'; // 4 PM to 8 PM (16:00 - 19:59)
    return 'Night'; // 8 PM to 4 AM
  }

  function getDefaultGameTitle(date = new Date()) {
    const timeOfDay = getTimeOfDay(date);
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    return `${dateStr} · ${timeOfDay} Poker`;
  }

  // Application State
  let state = {
    roomId: null,
    hostSecret: null,
    isHost: true,
    title: getDefaultGameTitle(),
    date: '',
    currency: '₹',
    defaultBuyin: 100,
    soundEnabled: true,
    players: [],
    status: 'active', // 'active' | 'ended'
    settlementSummary: '',
    lastUpdated: Date.now()
  };

  // Usual Players Roster (array of strings)
  let usualPlayers = [];

  // Temporary selection for New Game setup
  let selectedTonightPlayers = [];

  // Active sync manager instance
  let syncManager = null;
  let activeModalPlayerId = null;

  // Miscount reconciliation state (split equally vs manual shares)
  let miscountState = {
    mode: 'equal', // 'equal' | 'manual'
    manualShares: {}, // { [playerId]: number }
    diff: 0
  };

  function distributeEvenly(totalAmount, count) {
    if (count <= 0) return [];
    const base = Math.floor(totalAmount / count);
    let remainder = Math.round(totalAmount - (base * count));
    const result = [];
    for (let i = 0; i < count; i++) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      result.push(base + extra);
    }
    return result;
  }

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
    // Views
    viewHome: document.getElementById('viewHome'),
    viewGame: document.getElementById('viewGame'),
    brandLink: document.getElementById('brandLink'),
    btnNavHome: document.getElementById('btnNavHome'),

    // Header Status & Actions
    syncDot: document.getElementById('syncDot'),
    syncStatusText: document.getElementById('syncStatusText'),
    roomCodeBadge: document.getElementById('roomCodeBadge'),
    spectatorBanner: document.getElementById('spectatorBanner'),
    btnClaimHostPrompt: document.getElementById('btnClaimHostPrompt'),
    btnShareLive: document.getElementById('btnShareLive'),
    btnTransferHost: document.getElementById('btnTransferHost'),
    btnHeaderNewGame: document.getElementById('btnHeaderNewGame'),
    btnSettings: document.getElementById('btnSettings'),

    // Home View Elements
    gamesSection: document.getElementById('gamesSection'),
    gamesListContainer: document.getElementById('gamesListContainer'),
    noGamesMsg: document.getElementById('noGamesMsg'),

    // New Game Form
    newGameForm: document.getElementById('newGameForm'),
    newGameTitleInput: document.getElementById('newGameTitleInput'),
    newGameDefaultBuyin: document.getElementById('newGameDefaultBuyin'),
    newGameCurrencyTag: document.getElementById('newGameCurrencyTag'),
    selectedPlayersList: document.getElementById('selectedPlayersList'),
    selectedPlayersEmptyMsg: document.getElementById('selectedPlayersEmptyMsg'),
    selectedPlayersCount: document.getElementById('selectedPlayersCount'),
    launchPlayerCount: document.getElementById('launchPlayerCount'),
    btnClearSelectedPlayers: document.getElementById('btnClearSelectedPlayers'),

    // Search & Picker for New Game
    usualPlayerSearchInput: document.getElementById('usualPlayerSearchInput'),
    btnClearSearch: document.getElementById('btnClearSearch'),
    createPlayerPrompt: document.getElementById('createPlayerPrompt'),
    createPlayerPromptName: document.getElementById('createPlayerPromptName'),
    btnCreateNewPlayer: document.getElementById('btnCreateNewPlayer'),
    availableUsualCount: document.getElementById('availableUsualCount'),
    btnAddAllUsual: document.getElementById('btnAddAllUsual'),
    usualPlayersPickerGrid: document.getElementById('usualPlayersPickerGrid'),
    btnLaunchNewGame: document.getElementById('btnLaunchNewGame'),

    // Usual Players Roster
    addUsualPlayerForm: document.getElementById('addUsualPlayerForm'),
    addUsualPlayerInput: document.getElementById('addUsualPlayerInput'),
    btnAddUsualPlayer: document.getElementById('btnAddUsualPlayer'),
    rosterChipsList: document.getElementById('rosterChipsList'),
    emptyRosterMsg: document.getElementById('emptyRosterMsg'),
    btnLoadSampleRoster: document.getElementById('btnLoadSampleRoster'),

    // Sticky Bottom Bar
    gameBottomBar: document.getElementById('gameBottomBar'),

    // Game View Hero & Stats
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

    // In-game Add Player Section
    addPlayerSection: document.getElementById('addPlayerSection'),
    addPlayerForm: document.getElementById('addPlayerForm'),
    playerNameInput: document.getElementById('playerNameInput'),
    inGamePlayerSuggestions: document.getElementById('inGamePlayerSuggestions'),
    quickSuggestionsWrap: document.getElementById('quickSuggestionsWrap'),
    suggestionsList: document.getElementById('suggestionsList'),

    // Players Grid
    playersGrid: document.getElementById('playersGrid'),
    emptyPlayersState: document.getElementById('emptyPlayersState'),
    playerTotalBadge: document.getElementById('playerTotalBadge'),
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
    miscountSection: document.getElementById('miscountSection'),
    miscountTitle: document.getElementById('miscountTitle'),
    miscountSubtitle: document.getElementById('miscountSubtitle'),
    miscountBadge: document.getElementById('miscountBadge'),
    btnMiscountEqual: document.getElementById('btnMiscountEqual'),
    btnMiscountManual: document.getElementById('btnMiscountManual'),
    miscountEqualView: document.getElementById('miscountEqualView'),
    miscountEqualExplanation: document.getElementById('miscountEqualExplanation'),
    miscountEqualChips: document.getElementById('miscountEqualChips'),
    miscountManualView: document.getElementById('miscountManualView'),
    miscountManualSummaryText: document.getElementById('miscountManualSummaryText'),
    btnAutoSplitRemaining: document.getElementById('btnAutoSplitRemaining'),
    miscountManualPlayersList: document.getElementById('miscountManualPlayersList'),
    btnCalculateSettlement: document.getElementById('btnCalculateSettlement'),
    btnEndGameBack: document.getElementById('btnEndGameBack'),
    btnDeleteGameFromModal: document.getElementById('btnDeleteGameFromModal'),
    btnContinueGameFromModal: document.getElementById('btnContinueGameFromModal'),
    btnEndGameClose: document.getElementById('btnEndGameClose'),
    finalSummaryText: document.getElementById('finalSummaryText'),
    btnCopySummary: document.getElementById('btnCopySummary'),
    btnShareWhatsApp: document.getElementById('btnShareWhatsApp'),

    // Game Settled Banner
    gameEndedBanner: document.getElementById('gameEndedBanner'),
    btnBannerViewSummary: document.getElementById('btnBannerViewSummary'),
    btnBannerContinueGame: document.getElementById('btnBannerContinueGame'),
    btnBannerDeleteGame: document.getElementById('btnBannerDeleteGame'),

    // Post Game Choice Modal
    modalPostGameChoice: document.getElementById('modalPostGameChoice'),
    btnChoiceContinue: document.getElementById('btnChoiceContinue'),
    btnChoiceDelete: document.getElementById('btnChoiceDelete'),

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
  // Initialization & Storage
  // =========================================================================
  function init() {
    loadSettings();
    loadUsualPlayers();

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const claimParam = urlParams.get('claim');

    // Default formatted date and title (e.g. "Tuesday, Oct 20 · Afternoon Poker")
    const now = new Date();
    state.date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const defaultTitle = getDefaultGameTitle(now);

    let savedGame = null;
    try {
      savedGame = JSON.parse(localStorage.getItem(STORAGE_KEY_GAME) || 'null');
    } catch (e) {}

    if (roomParam) {
      // Direct room link opened -> enter game view
      state.roomId = roomParam.toUpperCase();
      const storedSecret = localStorage.getItem(`pokertracker_secret_${state.roomId}`);

      if (storedSecret && (!claimParam || storedSecret === claimParam)) {
        // User already holds this room's secret -> maintain Host authority
        state.hostSecret = storedSecret;
        state.isHost = true;
        state.pendingClaimSecret = null;
        if (claimParam) {
          try {
            const cleanUrl = `${window.location.origin}${window.location.pathname}?room=${state.roomId}#game`;
            history.replaceState(null, '', cleanUrl);
          } catch (e) {}
        }
      } else if (claimParam) {
        state.pendingClaimSecret = claimParam;
        state.isHost = false;
        state.hostSecret = null;
      } else if (storedSecret) {
        state.hostSecret = storedSecret;
        state.isHost = true;
      } else {
        state.isHost = false;
        state.hostSecret = null;
      }

      if (savedGame && savedGame.roomId === state.roomId) {
        state = { ...state, ...savedGame, isHost: state.isHost };
      }

      switchView('game');
      initSync();
    } else {
      // Visiting Home
      if (savedGame && savedGame.roomId) {
        state = { ...state, ...savedGame };
      } else {
        state.title = defaultTitle;
      }

      // Check if hash is #game and we have an active game
      if (window.location.hash === '#game' && state.roomId && state.players.length > 0) {
        switchView('game');
        initSync();
      } else {
        switchView('home');
      }
    }

    // Populate Home Form Defaults
    dom.newGameTitleInput.value = defaultTitle;
    dom.newGameDefaultBuyin.value = state.defaultBuyin || 100;
    dom.newGameCurrencyTag.textContent = state.currency || '₹';

    render();
    renderUsualRoster();
    renderUsualPickerGrid();
    renderGamesList();
    bindEvents();
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{}');
      if (saved.currency) state.currency = saved.currency;
      if (saved.defaultBuyin) state.defaultBuyin = Number(saved.defaultBuyin);
      else state.defaultBuyin = 100;
      if (typeof saved.soundEnabled === 'boolean') state.soundEnabled = saved.soundEnabled;
    } catch (e) {}
  }

  function loadUsualPlayers() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_USUAL) || 'null');
      if (Array.isArray(stored)) {
        usualPlayers = stored;
      } else {
        // Pre-populate sample on first visit
        usualPlayers = [...DEFAULT_SAMPLE_PLAYERS];
        saveUsualPlayers();
      }
    } catch (e) {
      usualPlayers = [...DEFAULT_SAMPLE_PLAYERS];
    }
  }

  function saveUsualPlayers() {
    try {
      localStorage.setItem(STORAGE_KEY_USUAL, JSON.stringify(usualPlayers));
    } catch (e) {}
  }

  function addUsualPlayer(name) {
    name = (name || '').trim();
    if (!name) return false;

    const exists = usualPlayers.some(p => p.toLowerCase() === name.toLowerCase());
    if (exists) {
      showToast(`"${name}" is already in your usual roster!`, 'warning');
      return false;
    }

    usualPlayers.push(name);
    saveUsualPlayers();
    renderUsualRoster();
    renderUsualPickerGrid();
    renderInGameSuggestions();
    showToast(`Added ${name} to Usual Players`, 'success');
    return true;
  }

  function removeUsualPlayer(name) {
    usualPlayers = usualPlayers.filter(p => p.toLowerCase() !== name.toLowerCase());
    saveUsualPlayers();
    renderUsualRoster();
    renderUsualPickerGrid();
    renderInGameSuggestions();
    showToast(`Removed ${name} from Usual Players`, 'warning');
  }

  // =========================================================================
  // Multi-Game Session Storage & Management
  // =========================================================================
  function getAllStoredGames() {
    let games = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY_GAMES);
      if (raw) {
        games = JSON.parse(raw);
      }
    } catch (e) {}

    // Backward compatibility: import legacy single game if not already in list
    try {
      const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY_GAME) || 'null');
      if (legacy && legacy.roomId && !games.some(g => g.roomId === legacy.roomId)) {
        games.unshift(legacy);
        localStorage.setItem(STORAGE_KEY_GAMES, JSON.stringify(games));
      }
    } catch (e) {}

    return Array.isArray(games) ? games : [];
  }

  function saveGameToCollection(gameState) {
    if (!gameState || !gameState.roomId) return;
    const games = getAllStoredGames();
    const idx = games.findIndex(g => g.roomId === gameState.roomId);
    const snapshot = {
      roomId: gameState.roomId,
      title: gameState.title,
      date: gameState.date,
      status: gameState.status || 'active',
      currency: gameState.currency || '₹',
      defaultBuyin: gameState.defaultBuyin || 100,
      players: gameState.players || [],
      settlementSummary: gameState.settlementSummary || '',
      hostSecret: gameState.hostSecret || null,
      isHost: gameState.isHost,
      lastUpdated: Date.now()
    };

    if (idx >= 0) {
      games[idx] = { ...games[idx], ...snapshot };
    } else {
      games.unshift(snapshot);
    }

    try {
      localStorage.setItem(STORAGE_KEY_GAMES, JSON.stringify(games));
    } catch (e) {}
  }

  function removeGameFromCollection(roomId) {
    if (!roomId) return;
    let games = getAllStoredGames();
    games = games.filter(g => g.roomId !== roomId);
    try {
      localStorage.setItem(STORAGE_KEY_GAMES, JSON.stringify(games));
    } catch (e) {}
    localStorage.removeItem(`pokertracker_secret_${roomId}`);
  }

  function renderGamesList() {
    if (!dom.gamesListContainer) return;
    const games = getAllStoredGames();
    dom.gamesListContainer.innerHTML = '';

    if (games.length === 0) {
      if (dom.gamesSection) dom.gamesSection.style.display = 'none';
      if (dom.noGamesMsg) dom.noGamesMsg.style.display = 'none';
      return;
    }

    if (dom.gamesSection) dom.gamesSection.style.display = 'block';
    if (dom.noGamesMsg) dom.noGamesMsg.style.display = 'none';

    games.forEach(g => {
      const card = document.createElement('div');
      card.className = `game-session-card ${g.status === 'ended' ? 'is-settled' : 'is-active'}`;

      const statusBadgeHtml = g.status === 'ended'
        ? `<span class="game-status-badge settled">🏁 Settled</span>`
        : `<span class="game-status-badge active"><span class="status-dot"></span> Live</span>`;

      card.innerHTML = `
        <div class="game-session-info">
          <div class="game-session-title-row">
            <span class="game-session-title">${escapeHtml(g.title || 'Poker Game')}</span>
            ${statusBadgeHtml}
            <span class="game-session-room">#${g.roomId}</span>
          </div>
        </div>
        <div class="game-session-actions">
          <button type="button" class="btn btn-primary btn-sm btn-open-session">
            ▶ Resume Game
          </button>
          <button type="button" class="btn btn-danger-ghost btn-sm btn-delete-session" title="Delete this game">
            🗑️
          </button>
        </div>
      `;

      card.querySelector('.btn-open-session').addEventListener('click', () => {
        openGameSession(g.roomId);
      });

      card.querySelector('.btn-delete-session').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSingleGameSession(g.roomId, g.title);
      });

      dom.gamesListContainer.appendChild(card);
    });
  }

  function openGameSession(roomId) {
    const games = getAllStoredGames();
    const found = games.find(g => g.roomId === roomId);
    if (!found) {
      showToast('Game session not found.', 'error');
      return;
    }

    const storedSecret = localStorage.getItem(`pokertracker_secret_${roomId}`);
    state = {
      ...found,
      hostSecret: storedSecret || found.hostSecret || null,
      isHost: !!(storedSecret || found.isHost)
    };

    localStorage.setItem(STORAGE_KEY_GAME, JSON.stringify(state));
    switchView('game');
    initSync();
    showToast(`Opened ${state.title}`, 'info');
  }

  function deleteSingleGameSession(roomId, title) {
    if (!confirm(`Are you sure you want to delete "${title || 'this game'}"? All records for this game will be removed.`)) {
      return;
    }

    removeGameFromCollection(roomId);

    // If the deleted game was currently loaded in memory, reset state
    if (state.roomId === roomId) {
      localStorage.removeItem(STORAGE_KEY_GAME);
      const now = new Date();
      state = {
        roomId: null,
        hostSecret: null,
        isHost: true,
        title: getDefaultGameTitle(now),
        date: now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        currency: state.currency || '₹',
        defaultBuyin: state.defaultBuyin || 100,
        soundEnabled: state.soundEnabled,
        players: [],
        status: 'active',
        settlementSummary: '',
        lastUpdated: Date.now()
      };
    }

    renderGamesList();
    showToast('🗑️ Game deleted successfully.', 'info');
  }

  // =========================================================================
  // View Routing (Home vs Game)
  // =========================================================================
  function switchView(viewName) {
    currentView = viewName;

    if (viewName === 'home') {
      dom.viewHome.style.display = 'block';
      dom.viewGame.style.display = 'none';

      // Hide game-specific controls in header & sticky bottom bar
      document.querySelectorAll('.game-only-control').forEach(el => el.style.display = 'none');
      if (dom.gameBottomBar) dom.gameBottomBar.style.display = 'none';
      dom.roomCodeBadge.style.display = 'none';

      // Refresh games list on Home
      renderGamesList();

      // Refresh default title for new game with current time
      const now = new Date();
      dom.newGameTitleInput.value = getDefaultGameTitle(now);

      // Set hash without jump
      if (window.location.hash !== '#home' && !window.location.search) {
        history.replaceState(null, '', '#home');
      }
    } else {
      dom.viewHome.style.display = 'none';
      dom.viewGame.style.display = 'block';

      // Show game controls
      document.querySelectorAll('.game-only-control').forEach(el => {
        if (el.classList.contains('host-only-control') && !state.isHost) {
          el.style.display = 'none';
        } else {
          el.style.display = '';
        }
      });
      if (dom.gameBottomBar) dom.gameBottomBar.style.display = '';
      dom.roomCodeBadge.style.display = '';

      if (window.location.hash !== '#game' && !window.location.search) {
        history.replaceState(null, '', '#game');
      }

      render();
    }
  }

  // =========================================================================
  // Game Setup & Initialization
  // =========================================================================
  function createAndLaunchGame() {
    const title = dom.newGameTitleInput.value.trim() || getDefaultGameTitle(new Date());
    const defaultBuyin = Number(dom.newGameDefaultBuyin.value) || 100;

    if (selectedTonightPlayers.length === 0) {
      showToast('Please add at least 1 player to start the game!', 'warning');
      dom.usualPlayerSearchInput.focus();
      return;
    }

    state.roomId = PokerSync.SyncManager.generateRoomId();
    state.hostSecret = PokerSync.SyncManager.generateSecret();
    state.isHost = true;
    state.title = title;
    state.defaultBuyin = defaultBuyin;
    state.status = 'active';
    state.settlementSummary = '';

    const now = new Date();
    state.date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    // Build player roster with 1 default buy-in each
    state.players = selectedTonightPlayers.map(name => ({
      id: 'p_' + Math.random().toString(36).substring(2, 9),
      name,
      buyIns: [defaultBuyin],
      clockedOut: false,
      cashOut: null,
      clockOutTime: null
    }));

    localStorage.setItem(`pokertracker_secret_${state.roomId}`, state.hostSecret);
    saveState();

    // Reset tonight's temporary selections on home
    selectedTonightPlayers = [];
    renderSelectedTonightPills();
    dom.usualPlayerSearchInput.value = '';
    dom.btnClearSearch.style.display = 'none';
    dom.createPlayerPrompt.style.display = 'none';
    renderUsualPickerGrid();

    // Switch to Game Dashboard
    switchView('game');
    initSync();
    playChimeSound();
    showToast(`Game launched with ${state.players.length} players!`, 'success');
  }

  function initSync() {
    if (syncManager) syncManager.cleanup();

    syncManager = new PokerSync.SyncManager({
      onStateReceived: (remoteState) => {
        if (!state.isHost) {
          state = {
            ...remoteState,
            isHost: false,
            roomId: state.roomId
          };
          saveState();
          render();
        }
      },
      onHostTransferred: (newHostName) => {
        if (state.isHost) {
          state.isHost = false;
          state.hostSecret = null;
          localStorage.removeItem(`pokertracker_secret_${state.roomId}`);
          saveState();
          render();
          showToast(`👑 Host transferred to ${newHostName}. You are now Spectating.`, 'warning');
        }
      },
      onHostPromoted: (newSecret, latestState) => {
        state.isHost = true;
        state.hostSecret = newSecret;
        state.pendingClaimSecret = null;
        if (latestState) {
          state = { ...state, ...latestState, isHost: true };
        }
        localStorage.setItem(`pokertracker_secret_${state.roomId}`, newSecret);
        saveState();
        render();

        // Strip claim parameter from URL so browser reloads stay safely on Host view
        try {
          const cleanUrl = `${window.location.origin}${window.location.pathname}?room=${state.roomId}#game`;
          history.replaceState(null, '', cleanUrl);
        } catch (e) {}

        showToast('👑 You claimed Host authority for this game!', 'success');
      },
      onConnectionChange: ({ status, message }) => {
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
      pendingClaimSecret: state.pendingClaimSecret || null,
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

    dom.roomCodeBadge.textContent = state.roomId ? `#${state.roomId}` : '';
  }

  function saveState() {
    state.lastUpdated = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY_GAME, JSON.stringify(state));
      saveGameToCollection(state);
    } catch (e) {}

    if (state.isHost && syncManager) {
      syncManager.broadcastState(state);
    }
  }

  // =========================================================================
  // Home View Rendering (Selected Players & Usual Players Picker)
  // =========================================================================
  function renderSelectedTonightPills() {
    dom.selectedPlayersList.innerHTML = '';
    const count = selectedTonightPlayers.length;
    dom.selectedPlayersCount.textContent = count;
    dom.launchPlayerCount.textContent = count;

    if (count === 0) {
      dom.selectedPlayersEmptyMsg.style.display = 'block';
      dom.selectedPlayersList.appendChild(dom.selectedPlayersEmptyMsg);
      dom.btnClearSelectedPlayers.style.display = 'none';
    } else {
      dom.selectedPlayersEmptyMsg.style.display = 'none';
      dom.btnClearSelectedPlayers.style.display = 'inline-block';

      selectedTonightPlayers.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'selected-player-chip';
        chip.innerHTML = `
          <span>${escapeHtml(name)}</span>
          <button type="button" class="remove-chip-btn" data-name="${escapeHtml(name)}" title="Remove ${escapeHtml(name)}">&times;</button>
        `;
        dom.selectedPlayersList.appendChild(chip);
      });
    }

    renderUsualPickerGrid();
  }

  function renderUsualPickerGrid() {
    const query = (dom.usualPlayerSearchInput.value || '').trim().toLowerCase();
    dom.usualPlayersPickerGrid.innerHTML = '';

    // Filter usual players based on search query
    const filtered = usualPlayers.filter(p => p.toLowerCase().includes(query));
    dom.availableUsualCount.textContent = usualPlayers.length;

    // Check if query is new (not in usual players and not empty)
    const exactMatch = usualPlayers.some(p => p.toLowerCase() === query);
    if (query && !exactMatch) {
      dom.createPlayerPrompt.style.display = 'flex';
      dom.createPlayerPromptName.textContent = dom.usualPlayerSearchInput.value.trim();
    } else {
      dom.createPlayerPrompt.style.display = 'none';
    }

    if (filtered.length === 0 && !query) {
      dom.usualPlayersPickerGrid.innerHTML = `
        <div style="grid-column: 1/-1; font-size: 0.8rem; color: var(--text-muted); padding: 0.5rem 0;">
          No usual players saved. Add some in the roster below!
        </div>
      `;
      return;
    }

    filtered.forEach(name => {
      const isSelected = selectedTonightPlayers.some(p => p.toLowerCase() === name.toLowerCase());
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `usual-player-card-btn ${isSelected ? 'is-selected' : ''}`;
      btn.innerHTML = `
        <span class="truncate">${escapeHtml(name)}</span>
        <span class="plus-badge">${isSelected ? '✓' : '+'}</span>
      `;

      if (!isSelected) {
        btn.addEventListener('click', () => {
          selectedTonightPlayers.push(name);
          playChipSound();
          renderSelectedTonightPills();
        });
      }

      dom.usualPlayersPickerGrid.appendChild(btn);
    });
  }

  function renderUsualRoster() {
    dom.rosterChipsList.innerHTML = '';
    if (usualPlayers.length === 0) {
      dom.emptyRosterMsg.style.display = 'block';
    } else {
      dom.emptyRosterMsg.style.display = 'none';
      usualPlayers.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'roster-chip';
        chip.innerHTML = `
          <span>${escapeHtml(name)}</span>
          <button type="button" class="roster-chip-remove" data-name="${escapeHtml(name)}" title="Remove ${escapeHtml(name)}">&times;</button>
        `;
        dom.rosterChipsList.appendChild(chip);
      });
    }
  }

  // =========================================================================
  // Game View Rendering
  // =========================================================================
  function render() {
    if (currentView !== 'game') return;

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

    // 5. In-game usual players suggestions
    renderInGameSuggestions();

    // 6. Game Ended Banner state
    if (state.status === 'ended') {
      if (dom.gameEndedBanner) dom.gameEndedBanner.style.display = 'flex';
      dom.btnEndGame.innerHTML = '<span>🏁 View Settle Results</span>';
    } else {
      if (dom.gameEndedBanner) dom.gameEndedBanner.style.display = 'none';
      dom.btnEndGame.innerHTML = '<span>🏁 End Game & Settle</span>';
    }

    // Update settings inputs
    dom.settingCurrencyInput.value = state.currency;
    dom.settingDefaultBuyinInput.value = state.defaultBuyin;
    dom.settingSoundToggle.checked = state.soundEnabled;
  }

  function renderInGameSuggestions() {
    const activeNames = state.players.map(p => p.name.toLowerCase());
    const available = usualPlayers.filter(n => !activeNames.includes(n.toLowerCase()));

    if (available.length > 0) {
      dom.quickSuggestionsWrap.style.display = 'flex';
      dom.suggestionsList.innerHTML = available.slice(0, 8)
        .map(n => `<button type="button" class="suggestion-chip in-game-quick-add" data-name="${escapeHtml(n)}">+ ${escapeHtml(n)}</button>`)
        .join('');
    } else {
      dom.quickSuggestionsWrap.style.display = 'none';
    }
  }

  function createPlayerCardElement(player) {
    const card = document.createElement('div');
    card.className = `player-card ${player.clockedOut ? 'is-clocked-out' : ''}`;
    card.id = `card-${player.id}`;

    const totalBuyin = (player.buyIns || []).reduce((sum, b) => sum + (Number(b) || 0), 0);
    const buyinCount = (player.buyIns || []).length;
    const initial = (player.name || '?').charAt(0).toUpperCase();

    const suits = ['♠', '♥', '♦', '♣'];
    const suit = suits[Math.abs(player.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 4];

    let statusBadgeHtml = '';
    if (player.clockedOut) {
      statusBadgeHtml = `<div class="player-clocked-badge">⏱️ Clocked Out</div>`;
    }

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

    let chipsHtml = '';
    (player.buyIns || []).forEach((b, idx) => {
      chipsHtml += `
        <span class="buyin-chip">
          <span>${state.currency}${Number(b).toLocaleString()}</span>
          ${state.isHost ? `<button class="buyin-chip-remove" data-player-id="${player.id}" data-chip-idx="${idx}" title="Remove buy-in">×</button>` : ''}
        </span>
      `;
    });

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
            <div style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">Cashed Out</div>
            <div style="font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; color: #FFFFFF;">
              ${state.currency}${Number(player.cashOut || 0).toLocaleString()}
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">From ${state.currency}${totalBuyin.toLocaleString()} bought in</div>
          </div>
          <div class="clockout-net-badge ${netClass}">${netStr}</div>
        </div>
      `;

      if (state.isHost) {
        footerHtml = `
          <div style="display: flex; gap: 0.5rem; margin-top: auto;">
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
  // Game Actions (Add, Buy-in, Rebuy, Clock-out)
  // =========================================================================
  function addPlayerToGame(name) {
    name = (name || '').trim();
    if (!name) return;

    const exists = state.players.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      showToast(`Player "${name}" is already at the table!`, 'warning');
      return;
    }

    const newPlayer = {
      id: 'p_' + Math.random().toString(36).substring(2, 9),
      name,
      buyIns: [state.defaultBuyin],
      clockedOut: false,
      cashOut: null,
      clockOutTime: null
    };

    state.players.push(newPlayer);

    // Also remember in usual players if not present
    if (!usualPlayers.some(p => p.toLowerCase() === name.toLowerCase())) {
      usualPlayers.push(name);
      saveUsualPlayers();
    }

    playChipSound();
    saveState();
    render();
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
    showToast(`${player.name} rejoined the active game!`, 'success');
  }

  function removePlayer(playerId) {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    if (confirm(`Remove "${player.name}" from the game?`)) {
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

    miscountState.mode = 'equal';
    miscountState.manualShares = {};

    dom.endGameStage1.style.display = 'block';
    dom.endGameStage2.style.display = 'none';
    dom.btnEndGameBack.style.display = 'none';
    dom.btnCalculateSettlement.style.display = '';
    if (dom.btnDeleteGameFromModal) dom.btnDeleteGameFromModal.style.display = 'none';
    if (dom.btnContinueGameFromModal) dom.btnContinueGameFromModal.style.display = 'none';

    let totalPot = 0;
    state.players.forEach(p => {
      totalPot += (p.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
    });
    dom.reconcilePot.textContent = `${state.currency}${totalPot.toLocaleString()}`;

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

    state.players.forEach(p => {
      totalPot += (p.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
      if (p.clockedOut) {
        totalCounted += Number(p.cashOut) || 0;
      }
    });

    dom.endGamePlayersList.querySelectorAll('.end-game-count-input').forEach(inp => {
      totalCounted += Number(inp.value) || 0;
    });

    totalPot = Math.round(totalPot * 100) / 100;
    totalCounted = Math.round(totalCounted * 100) / 100;
    const diff = Math.round((totalCounted - totalPot) * 100) / 100;
    miscountState.diff = diff;

    if (Math.abs(diff) < 0.01) {
      dom.reconcileBox.classList.remove('has-error');
      dom.reconcileStatusText.className = 'reconcile-status status-ok';
      dom.reconcileStatusText.textContent = `✓ Balanced (${state.currency}${totalCounted.toLocaleString()})`;
    } else if (diff > 0) {
      dom.reconcileBox.classList.add('has-error');
      dom.reconcileStatusText.className = 'reconcile-status status-error';
      dom.reconcileStatusText.textContent = `⚠️ +${state.currency}${diff.toLocaleString()} extra counted`;
    } else {
      dom.reconcileBox.classList.add('has-error');
      dom.reconcileStatusText.className = 'reconcile-status status-error';
      dom.reconcileStatusText.textContent = `⚠️ −${state.currency}${Math.abs(diff).toLocaleString()} missing`;
    }

    renderMiscountReconciliationUI(diff);
  }

  function renderMiscountReconciliationUI(diff) {
    if (!dom.miscountSection) return;

    if (Math.abs(diff) < 0.01) {
      dom.miscountSection.style.display = 'none';
      return;
    }

    dom.miscountSection.style.display = 'block';
    const isSurplus = diff > 0;
    const absDiff = Math.abs(diff);

    if (isSurplus) {
      dom.miscountSection.classList.add('is-surplus');
      dom.miscountTitle.textContent = 'ℹ️ Pot Surplus Detected';
      dom.miscountSubtitle.textContent = `Counted chips exceed recorded pot by ${state.currency}${absDiff.toLocaleString()}.`;
      dom.miscountBadge.textContent = `+${state.currency}${absDiff.toLocaleString()}`;
    } else {
      dom.miscountSection.classList.remove('is-surplus');
      dom.miscountTitle.textContent = '⚖️ Pot Shortage Detected';
      dom.miscountSubtitle.textContent = `Counted chips are ${state.currency}${absDiff.toLocaleString()} short of recorded pot.`;
      dom.miscountBadge.textContent = `−${state.currency}${absDiff.toLocaleString()}`;
    }

    if (miscountState.mode === 'equal') {
      dom.btnMiscountEqual.classList.add('active');
      dom.btnMiscountManual.classList.remove('active');
      dom.miscountEqualView.style.display = 'block';
      dom.miscountManualView.style.display = 'none';

      const playerCount = state.players.length || 1;
      const parts = distributeEvenly(Math.round(absDiff * 100), playerCount);
      const sign = isSurplus ? '+' : '−';
      dom.miscountEqualExplanation.textContent = `Splitting ${isSurplus ? 'surplus' : 'shortage'} of ${state.currency}${absDiff.toLocaleString()} equally across all ${playerCount} players:`;

      dom.miscountEqualChips.innerHTML = '';
      state.players.forEach((p, idx) => {
        const shareAmt = parts[idx] / 100;
        const chip = document.createElement('span');
        chip.className = 'miscount-chip-pill';
        chip.innerHTML = `<span>${escapeHtml(p.name)}:</span> <strong>${sign}${state.currency}${shareAmt.toLocaleString()}</strong>`;
        dom.miscountEqualChips.appendChild(chip);
      });
    } else {
      dom.btnMiscountEqual.classList.remove('active');
      dom.btnMiscountManual.classList.add('active');
      dom.miscountEqualView.style.display = 'none';
      dom.miscountManualView.style.display = 'block';

      state.players.forEach(p => {
        if (typeof miscountState.manualShares[p.id] !== 'number') {
          miscountState.manualShares[p.id] = 0;
        }
      });

      renderMiscountManualList(absDiff, isSurplus);
    }
  }

  function renderMiscountManualList(absDiff, isSurplus) {
    let allocated = 0;
    state.players.forEach(p => {
      allocated += Number(miscountState.manualShares[p.id]) || 0;
    });
    allocated = Math.round(allocated * 100) / 100;
    const remaining = Math.round((absDiff - allocated) * 100) / 100;

    const statusBar = dom.miscountManualSummaryText.parentElement;
    if (Math.abs(remaining) < 0.01) {
      statusBar.className = 'miscount-manual-status-bar is-complete';
      dom.miscountManualSummaryText.innerHTML = `✓ 100% Allocated (${state.currency}${allocated.toLocaleString()} distributed)`;
      dom.btnAutoSplitRemaining.style.display = 'none';
    } else if (remaining > 0) {
      statusBar.className = 'miscount-manual-status-bar has-error';
      dom.miscountManualSummaryText.innerHTML = `Allocated: ${state.currency}${allocated.toLocaleString()} / ${state.currency}${absDiff.toLocaleString()} &middot; <span style="color:var(--color-rose-light);">${state.currency}${remaining.toLocaleString()} remaining</span>`;
      dom.btnAutoSplitRemaining.style.display = 'inline-flex';
      dom.btnAutoSplitRemaining.textContent = `⚡ Distribute Remaining (${state.currency}${remaining.toLocaleString()})`;
    } else {
      statusBar.className = 'miscount-manual-status-bar has-error';
      dom.miscountManualSummaryText.innerHTML = `Allocated: ${state.currency}${allocated.toLocaleString()} / ${state.currency}${absDiff.toLocaleString()} &middot; <span style="color:var(--color-rose-light);">${state.currency}${Math.abs(remaining).toLocaleString()} over-allocated</span>`;
      dom.btnAutoSplitRemaining.style.display = 'none';
    }

    const step = (state.defaultBuyin && state.defaultBuyin >= 100) ? 10 : (state.defaultBuyin && state.defaultBuyin >= 20 ? 5 : 1);

    dom.miscountManualPlayersList.innerHTML = '';
    state.players.forEach(p => {
      const currentShare = Number(miscountState.manualShares[p.id]) || 0;
      const row = document.createElement('div');
      row.className = 'miscount-manual-row';
      row.innerHTML = `
        <div class="miscount-manual-player-info">
          <span class="miscount-manual-player-name">${escapeHtml(p.name)}</span>
          <span class="miscount-manual-player-subtext">Share of miscount:</span>
        </div>
        <div class="miscount-stepper">
          <button type="button" class="btn-stepper btn-miscount-dec" data-player-id="${p.id}" title="Decrease share by ${state.currency}${step}">−</button>
          <input type="number" class="input-miscount-share" data-player-id="${p.id}" value="${currentShare}" min="0" step="any">
          <button type="button" class="btn-stepper btn-miscount-inc" data-player-id="${p.id}" title="Increase share by ${state.currency}${step}">+</button>
        </div>
      `;
      dom.miscountManualPlayersList.appendChild(row);
    });
  }

  function calculateAndDisplaySettlement() {
    dom.endGamePlayersList.querySelectorAll('.end-game-count-input').forEach(inp => {
      const pId = inp.dataset.playerId;
      const val = Number(inp.value) || 0;
      const player = state.players.find(p => p.id === pId);
      if (player && !player.clockedOut) {
        player.cashOut = val;
      }
    });

    // Check balance and reconcile miscount if needed
    const balance = PokerSettlement.validateBalance(state.players);
    let miscountAdjustments = {};
    let miscountInfo = null;

    if (!balance.isBalanced) {
      const absDiff = Math.abs(balance.diff);
      const isMissing = balance.diff < 0;

      if (miscountState.mode === 'manual') {
        let sumShares = 0;
        state.players.forEach(p => {
          sumShares += (Number(miscountState.manualShares[p.id]) || 0);
        });
        const remaining = Math.round((absDiff - sumShares) * 100) / 100;
        if (Math.abs(remaining) >= 0.01 && state.players.length > 0) {
          const parts = distributeEvenly(Math.round(remaining * 100), state.players.length);
          state.players.forEach((p, idx) => {
            miscountState.manualShares[p.id] = Math.round(((Number(miscountState.manualShares[p.id]) || 0) + (parts[idx] / 100)) * 100) / 100;
          });
        }

        state.players.forEach(p => {
          const share = Number(miscountState.manualShares[p.id]) || 0;
          miscountAdjustments[p.id] = isMissing ? share : -share;
        });

        miscountInfo = {
          diff: balance.diff,
          mode: 'manual',
          shares: { ...miscountState.manualShares }
        };
      } else {
        // Equal split mode (default)
        const parts = distributeEvenly(Math.round(absDiff * 100), state.players.length);
        state.players.forEach((p, idx) => {
          const share = parts[idx] / 100;
          miscountAdjustments[p.id] = isMissing ? share : -share;
        });

        miscountInfo = {
          diff: balance.diff,
          mode: 'equal',
          sharePerPlayer: Math.round((absDiff / state.players.length) * 100) / 100
        };
      }
    }

    const leaderboard = PokerSettlement.calculateLeaderboard(state.players, state.currency, miscountAdjustments);
    const transactions = PokerSettlement.calculateSettlement(leaderboard);
    const gameUrl = syncManager ? syncManager.getSpectatorUrl() : window.location.href;

    const summaryText = PokerSettlement.generateSummaryText({
      gameTitle: state.title,
      gameDate: state.date,
      leaderboard,
      transactions,
      gameUrl,
      currency: state.currency,
      miscountInfo
    });

    state.settlementSummary = summaryText;
    state.status = 'ended';
    saveState();

    dom.finalSummaryText.textContent = summaryText;
    dom.endGameStage1.style.display = 'none';
    dom.endGameStage2.style.display = 'block';
    dom.btnEndGameBack.style.display = 'inline-flex';
    dom.btnCalculateSettlement.style.display = 'none';
    if (dom.btnDeleteGameFromModal) dom.btnDeleteGameFromModal.style.display = 'inline-flex';
    if (dom.btnContinueGameFromModal) dom.btnContinueGameFromModal.style.display = 'inline-flex';

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

  function viewSettlementSummaryModal() {
    dom.endGameStage1.style.display = 'none';
    dom.endGameStage2.style.display = 'block';
    dom.btnEndGameBack.style.display = 'inline-flex';
    dom.btnCalculateSettlement.style.display = 'none';
    if (dom.btnDeleteGameFromModal) dom.btnDeleteGameFromModal.style.display = 'inline-flex';
    if (dom.btnContinueGameFromModal) dom.btnContinueGameFromModal.style.display = 'inline-flex';
    openModal(dom.modalEndGame);
  }

  function deleteGameSession(skipConfirm = false) {
    if (!skipConfirm && !confirm('Are you sure you want to delete this game session? All buy-ins for tonight will be cleared.')) {
      return;
    }

    const oldRoom = state.roomId;
    if (oldRoom) {
      removeGameFromCollection(oldRoom);
      localStorage.removeItem(`pokertracker_secret_${oldRoom}`);
    }
    localStorage.removeItem(STORAGE_KEY_GAME);

    if (syncManager) {
      syncManager.cleanup();
      syncManager = null;
    }

    const now = new Date();
    state = {
      roomId: null,
      hostSecret: null,
      isHost: true,
      title: getDefaultGameTitle(now),
      date: now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      currency: state.currency || '₹',
      defaultBuyin: state.defaultBuyin || 100,
      soundEnabled: state.soundEnabled,
      players: [],
      status: 'active',
      settlementSummary: '',
      lastUpdated: Date.now()
    };

    closeModal(dom.modalEndGame);
    closeModal(dom.modalPostGameChoice);
    if (dom.gameEndedBanner) dom.gameEndedBanner.style.display = 'none';
    selectedTonightPlayers = [];
    renderSelectedTonightPills();
    switchView('home');
    renderGamesList();
    showToast('🗑️ Game deleted. You can start a fresh game anytime.', 'info');
  }

  function continueGameSession() {
    state.status = 'active';
    state.players.forEach(p => {
      if (!p.clockedOut) {
        p.cashOut = null;
      }
    });

    saveState();
    closeModal(dom.modalEndGame);
    closeModal(dom.modalPostGameChoice);
    if (dom.gameEndedBanner) dom.gameEndedBanner.style.display = 'none';
    render();
    showToast('▶ Game resumed! You can continue adding buy-ins and playing.', 'success');
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
      showToast('Could not auto-copy. Please select manually.', 'warning');
    }
    ta.remove();
  }

  // =========================================================================
  // Event Bindings
  // =========================================================================
  function bindEvents() {
    // Brand link & Home nav
    dom.brandLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('home');
    });

    dom.btnNavHome.addEventListener('click', () => {
      switchView('home');
    });

    // New Game Form submission
    dom.newGameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      createAndLaunchGame();
    });

    // Usual Player Search filtering on Home
    dom.usualPlayerSearchInput.addEventListener('input', () => {
      const q = dom.usualPlayerSearchInput.value.trim();
      dom.btnClearSearch.style.display = q ? 'block' : 'none';
      renderUsualPickerGrid();
    });

    dom.btnClearSearch.addEventListener('click', () => {
      dom.usualPlayerSearchInput.value = '';
      dom.btnClearSearch.style.display = 'none';
      renderUsualPickerGrid();
      dom.usualPlayerSearchInput.focus();
    });

    // Create New Player button if not in usual list
    dom.btnCreateNewPlayer.addEventListener('click', () => {
      const name = dom.usualPlayerSearchInput.value.trim();
      if (!name) return;

      // Add to tonight's table
      if (!selectedTonightPlayers.includes(name)) {
        selectedTonightPlayers.push(name);
      }
      // Add to usual roster
      addUsualPlayer(name);

      dom.usualPlayerSearchInput.value = '';
      dom.btnClearSearch.style.display = 'none';
      renderSelectedTonightPills();
      playChipSound();
      showToast(`Created "${name}" and added to tonight's game!`, 'success');
    });

    // Add all usual players to tonight
    dom.btnAddAllUsual.addEventListener('click', () => {
      usualPlayers.forEach(name => {
        if (!selectedTonightPlayers.some(p => p.toLowerCase() === name.toLowerCase())) {
          selectedTonightPlayers.push(name);
        }
      });
      playChipSound();
      renderSelectedTonightPills();
    });

    // Clear all tonight selected players
    dom.btnClearSelectedPlayers.addEventListener('click', () => {
      selectedTonightPlayers = [];
      renderSelectedTonightPills();
    });

    // Selected players pill click delegation (remove chip)
    dom.selectedPlayersList.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.remove-chip-btn');
      if (removeBtn && removeBtn.dataset.name) {
        selectedTonightPlayers = selectedTonightPlayers.filter(p => p !== removeBtn.dataset.name);
        renderSelectedTonightPills();
      }
    });

    // Manage Usual Players Form
    function handleAddUsualPlayerSubmit(e) {
      if (e) e.preventDefault();
      const val = (dom.addUsualPlayerInput.value || '').trim();
      if (!val) {
        showToast('Please enter a player name first', 'warning');
        dom.addUsualPlayerInput.focus();
        return;
      }
      if (addUsualPlayer(val)) {
        dom.addUsualPlayerInput.value = '';
        dom.addUsualPlayerInput.focus();
      }
    }

    if (dom.addUsualPlayerForm) {
      dom.addUsualPlayerForm.addEventListener('submit', handleAddUsualPlayerSubmit);
    }
    if (dom.btnAddUsualPlayer) {
      dom.btnAddUsualPlayer.addEventListener('click', handleAddUsualPlayerSubmit);
    }

    // Usual Roster chip remove delegation
    dom.rosterChipsList.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.roster-chip-remove');
      if (removeBtn && removeBtn.dataset.name) {
        removeUsualPlayer(removeBtn.dataset.name);
      }
    });

    // Sample group button
    dom.btnLoadSampleRoster.addEventListener('click', () => {
      DEFAULT_SAMPLE_PLAYERS.forEach(name => {
        if (!usualPlayers.some(p => p.toLowerCase() === name.toLowerCase())) {
          usualPlayers.push(name);
        }
      });
      saveUsualPlayers();
      renderUsualRoster();
      renderUsualPickerGrid();
      showToast('Loaded sample poker group!', 'success');
    });

    // Header New Game button
    dom.btnHeaderNewGame.addEventListener('click', () => {
      dom.newGameTitleInput.value = getDefaultGameTitle(new Date());
      dom.newGameDefaultBuyin.value = state.defaultBuyin || 100;
      switchView('home');
      dom.newGameTitleInput.focus();
    });

    // Game View Title input
    dom.gameTitleInput.addEventListener('change', () => {
      state.title = dom.gameTitleInput.value.trim() || 'Poker Night';
      saveState();
    });

    // In-game Add Player Form
    dom.addPlayerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addPlayerToGame(dom.playerNameInput.value);
      dom.playerNameInput.value = '';
    });

    // In-game quick suggestions delegation
    dom.suggestionsList.addEventListener('click', (e) => {
      const chip = e.target.closest('.in-game-quick-add');
      if (chip && chip.dataset.name) {
        addPlayerToGame(chip.dataset.name);
      }
    });

    // In-game Player card actions delegation
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

    // Custom Buyin Presets
    document.querySelectorAll('.quick-amount-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        dom.customBuyinAmount.value = btn.dataset.amount;
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

    dom.roomCodeBadge.addEventListener('click', () => {
      if (syncManager) {
        copyToClipboard(syncManager.getSpectatorUrl(), 'Spectator room link copied!');
      }
    });

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
    // End Game modal back button
    dom.btnEndGameBack.addEventListener('click', () => {
      dom.endGameStage1.style.display = 'block';
      dom.endGameStage2.style.display = 'none';
      dom.btnEndGameBack.style.display = 'none';
      dom.btnCalculateSettlement.style.display = '';
      if (dom.btnDeleteGameFromModal) dom.btnDeleteGameFromModal.style.display = 'none';
      if (dom.btnContinueGameFromModal) dom.btnContinueGameFromModal.style.display = 'none';
    });

    // Miscount Reconciliation Mode Toggles & Stepper Actions
    if (dom.btnMiscountEqual) {
      dom.btnMiscountEqual.addEventListener('click', () => {
        miscountState.mode = 'equal';
        renderMiscountReconciliationUI(miscountState.diff);
      });
    }

    if (dom.btnMiscountManual) {
      dom.btnMiscountManual.addEventListener('click', () => {
        miscountState.mode = 'manual';
        const absDiff = Math.abs(miscountState.diff);
        let sumCurrent = 0;
        state.players.forEach(p => { sumCurrent += (Number(miscountState.manualShares[p.id]) || 0); });
        if (Math.abs(sumCurrent - absDiff) > 0.01 && state.players.length > 0) {
          const parts = distributeEvenly(Math.round(absDiff * 100), state.players.length);
          state.players.forEach((p, idx) => {
            miscountState.manualShares[p.id] = parts[idx] / 100;
          });
        }
        renderMiscountReconciliationUI(miscountState.diff);
      });
    }

    if (dom.btnAutoSplitRemaining) {
      dom.btnAutoSplitRemaining.addEventListener('click', () => {
        const absDiff = Math.abs(miscountState.diff);
        let allocated = 0;
        state.players.forEach(p => { allocated += Number(miscountState.manualShares[p.id]) || 0; });
        const remaining = Math.round((absDiff - allocated) * 100) / 100;
        if (remaining > 0 && state.players.length > 0) {
          const parts = distributeEvenly(Math.round(remaining * 100), state.players.length);
          state.players.forEach((p, idx) => {
            miscountState.manualShares[p.id] = Math.round(((Number(miscountState.manualShares[p.id]) || 0) + (parts[idx] / 100)) * 100) / 100;
          });
          renderMiscountManualList(absDiff, miscountState.diff > 0);
        }
      });
    }

    if (dom.miscountManualPlayersList) {
      dom.miscountManualPlayersList.addEventListener('click', (e) => {
        const incBtn = e.target.closest('.btn-miscount-inc');
        const decBtn = e.target.closest('.btn-miscount-dec');
        const step = (state.defaultBuyin && state.defaultBuyin >= 100) ? 10 : (state.defaultBuyin && state.defaultBuyin >= 20 ? 5 : 1);
        const absDiff = Math.abs(miscountState.diff);

        if (incBtn) {
          const pId = incBtn.dataset.playerId;
          const curr = Number(miscountState.manualShares[pId]) || 0;
          miscountState.manualShares[pId] = Math.round((curr + step) * 100) / 100;
          renderMiscountManualList(absDiff, miscountState.diff > 0);
          return;
        }

        if (decBtn) {
          const pId = decBtn.dataset.playerId;
          const curr = Number(miscountState.manualShares[pId]) || 0;
          miscountState.manualShares[pId] = Math.max(0, Math.round((curr - step) * 100) / 100);
          renderMiscountManualList(absDiff, miscountState.diff > 0);
          return;
        }
      });

      dom.miscountManualPlayersList.addEventListener('input', (e) => {
        const inp = e.target.closest('.input-miscount-share');
        if (inp) {
          const pId = inp.dataset.playerId;
          const val = Math.max(0, Number(inp.value) || 0);
          miscountState.manualShares[pId] = val;
          const absDiff = Math.abs(miscountState.diff);
          let allocated = 0;
          state.players.forEach(p => { allocated += Number(miscountState.manualShares[p.id]) || 0; });
          allocated = Math.round(allocated * 100) / 100;
          const remaining = Math.round((absDiff - allocated) * 100) / 100;
          const statusBar = dom.miscountManualSummaryText.parentElement;
          if (Math.abs(remaining) < 0.01) {
            statusBar.className = 'miscount-manual-status-bar is-complete';
            dom.miscountManualSummaryText.innerHTML = `✓ 100% Allocated (${state.currency}${allocated.toLocaleString()} distributed)`;
            dom.btnAutoSplitRemaining.style.display = 'none';
          } else if (remaining > 0) {
            statusBar.className = 'miscount-manual-status-bar has-error';
            dom.miscountManualSummaryText.innerHTML = `Allocated: ${state.currency}${allocated.toLocaleString()} / ${state.currency}${absDiff.toLocaleString()} &middot; <span style="color:var(--color-rose-light);">${state.currency}${remaining.toLocaleString()} remaining</span>`;
            dom.btnAutoSplitRemaining.style.display = 'inline-flex';
            dom.btnAutoSplitRemaining.textContent = `⚡ Distribute Remaining (${state.currency}${remaining.toLocaleString()})`;
          } else {
            statusBar.className = 'miscount-manual-status-bar has-error';
            dom.miscountManualSummaryText.innerHTML = `Allocated: ${state.currency}${allocated.toLocaleString()} / ${state.currency}${absDiff.toLocaleString()} &middot; <span style="color:var(--color-rose-light);">${state.currency}${Math.abs(remaining).toLocaleString()} over-allocated</span>`;
            dom.btnAutoSplitRemaining.style.display = 'none';
          }
        }
      });
    }

    // Post Game Buttons
    if (dom.btnDeleteGameFromModal) dom.btnDeleteGameFromModal.addEventListener('click', () => deleteGameSession(false));
    if (dom.btnContinueGameFromModal) dom.btnContinueGameFromModal.addEventListener('click', continueGameSession);

    if (dom.btnEndGameClose) {
      dom.btnEndGameClose.addEventListener('click', () => {
        closeModal(dom.modalEndGame);
        if (state.status === 'ended') {
          openModal(dom.modalPostGameChoice);
        }
      });
    }

    // Post Game Choice Modal buttons
    if (dom.btnChoiceContinue) dom.btnChoiceContinue.addEventListener('click', continueGameSession);
    if (dom.btnChoiceDelete) dom.btnChoiceDelete.addEventListener('click', () => deleteGameSession(true));

    // Game Settled Banner actions
    if (dom.btnBannerViewSummary) dom.btnBannerViewSummary.addEventListener('click', viewSettlementSummaryModal);
    if (dom.btnBannerContinueGame) dom.btnBannerContinueGame.addEventListener('click', continueGameSession);
    if (dom.btnBannerDeleteGame) dom.btnBannerDeleteGame.addEventListener('click', () => deleteGameSession(false));

    dom.btnCopySummary.addEventListener('click', () => {
      copyToClipboard(state.settlementSummary, '📋 Final summary copied! Paste it in WhatsApp.');
    });

    dom.btnShareWhatsApp.addEventListener('click', () => {
      const url = `https://wa.me/?text=${encodeURIComponent(state.settlementSummary)}`;
      window.open(url, '_blank');
    });

    dom.tabSpectator.addEventListener('click', () => switchShareTab('spectator'));
    dom.tabTransfer.addEventListener('click', () => switchShareTab('transfer'));
    dom.btnCopySpectatorLink.addEventListener('click', () => {
      copyToClipboard(dom.spectatorLinkInput.value, 'Spectator link copied!');
    });
    dom.btnCopyHostTransferLink.addEventListener('click', () => {
      copyToClipboard(dom.hostTransferLinkInput.value, '👑 Host transfer link copied! Send to new host.');
    });

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

    dom.btnSaveSettings.addEventListener('click', () => {
      state.currency = dom.settingCurrencyInput.value.trim() || '₹';
      state.defaultBuyin = Number(dom.settingDefaultBuyinInput.value) || 100;
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

    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = btn.dataset.modal;
        if (modalId) {
          const m = document.getElementById(modalId);
          if (m) closeModal(m);
          if (modalId === 'modalEndGame' && state.status === 'ended') {
            openModal(dom.modalPostGameChoice);
          }
        }
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeModal(overlay);
          if (overlay.id === 'modalEndGame' && state.status === 'ended') {
            openModal(dom.modalPostGameChoice);
          }
        }
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
        activeModals.forEach(m => closeModal(m));
        if (activeModals.some(m => m.id === 'modalEndGame') && state.status === 'ended') {
          openModal(dom.modalPostGameChoice);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

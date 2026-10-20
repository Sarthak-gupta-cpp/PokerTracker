# 🃏 PokerTracker

> A clean, minimalist web app to track poker buy-ins, rebuys, and cash-outs during home games — with instant P2P live streaming, mid-game clock outs, and automatic debt simplification. Fully static, serverless, and ready to host on **GitHub Pages**.

![PokerTracker Preview](https://img.shields.io/badge/Status-Ready-emerald?style=for-the-badge) ![GitHub Pages](https://img.shields.io/badge/Hosting-GitHub%20Pages-blue?style=for-the-badge) ![WebRTC](https://img.shields.io/badge/Sync-PeerJS%20WebRTC-indigo?style=for-the-badge)

---

## ✨ Features

- **♠️ Clean & Minimalist Aesthetics**: Dark obsidian slate UI with emerald accents, high-contrast typography, and smooth micro-animations.
- **💰 Live Money in the Game**: Real-time counter of total pot/buy-ins, active players, and average stack.
- **⚡ 1-Tap Rebuys & Custom Buy-ins**: Configurable default buy-in (e.g. ₹200) for instant 1-tap rebuys, plus custom amount input with quick presets (+100, +200, +500, +1000).
- **⏱️ Mid-Game Clock Out**: Any player leaving early can clock out with their final chip count; the app tracks their net profit/loss and locks their count while keeping the pot reconciled.
- **🏁 End Game Settlement & Debt Simplification**:
  - Prompts for chip counts of all remaining active players.
  - Live balance validation (checks if total counted chips match total pot with discrepancy warnings).
  - Calculates leaderboard with rankings (🥇, 🥈, 🥉, 4., 5., ...).
  - **Greedy debt minimization algorithm**: Minimizes the number of cash transfers between players (`Who owes who`).
  - **1-Click Shareable Summary**: Formats WhatsApp/Telegram ready text matching your exact style:
    ```text
    🃏 Tuesday Night Poker · Tuesday, Oct 20
    🥇 Sam  +₹386
    🥈 Vidit  +₹370
    🥉 Anmol  ₹0
    4. Megh  −₹68
    5. Kalash  −₹74
    6. Aarav  −₹100
    7. Ishaan  −₹200
    8. Adit  −₹340

    Game page and leaderboard: https://sarthak-gupta-cpp.github.io/PokerTracker/?room=8V8DNG

    Who owes who:
    • Adit → Vidit  ₹314
    • Ishaan → Sam  ₹200
    • Kalash → Sam  ₹74
    • Megh → Sam  ₹68
    • Aarav → Vidit  ₹56
    • Aarav → Sam  ₹44
    ```
- **📡 Live Spectator Link & QR Code**: Zero-backend WebRTC live streaming via PeerJS. Anyone at the table can scan the host's screen QR code or click the link to watch the ledger update in real time.
- **👑 Host Rights Transfer**: The host can generate a secure transfer link or pass host control directly to any player.
- **💾 Local Persistence**: Saves all players and buy-ins in `localStorage`, so refreshing or closing the browser never loses your game. Remembers recent players for 1-click roster additions next poker night.
- **🔊 Subtle Audio Effects**: Procedural Web Audio chip clicks and victory chimes (no external audio files required, toggleable in Settings).

---

## 🚀 How to Deploy on GitHub Pages

1. **Commit and push** the code to your GitHub repository:
   ```bash
   git add .
   git commit -m "Initial release of PokerTracker"
   git push origin main
   ```

2. **Enable GitHub Pages**:
   - Go to your repository on GitHub: `https://github.com/Sarthak-gupta-cpp/PokerTracker`
   - Click **Settings** (top tab) ➔ **Pages** (in the left sidebar under "Code and automation").
   - Under **Build and deployment** > **Branch**:
     - Select branch: `main`
     - Select folder: `/ (root)`
     - Click **Save**.

3. **Open your live app**:
   - GitHub Pages will deploy your site in ~1 minute at:
     ```
     https://sarthak-gupta-cpp.github.io/PokerTracker/
     ```

---

## 🛠️ Project Structure

```text
PokerTracker/
├── index.html          # Semantic HTML5 app structure and modals
├── favicon.svg         # Poker chip SVG favicon
├── css/
│   └── style.css       # Obsidian-slate dark design system & responsive layout
├── js/
│   ├── app.js          # Main UI controller, audio synthesis, state management
│   ├── settlement.js   # Leaderboard ranking & debt minimization algorithm
│   └── sync.js         # PeerJS WebRTC live sync & secure host transfer
└── README.md
```

---

## 🎮 How to Use During a Game

1. **Start Game**: Open the web app on your phone, tablet, or laptop.
2. **Add Players**: Type player names in the input bar or click recent player suggestions. Each player starts with 1 default buy-in.
3. **Rebuys**: Tap `+₹200` on any player card for a quick rebuy, or `+Custom` for an irregular amount.
4. **Share with Table**: Click **Share Live** to display the QR code or copy the spectator link for players to watch live.
5. **Clock Out Early**: If someone leaves early, tap **Clock Out** on their card and enter their ending chips.
6. **Pass Host** *(Optional)*: If the host needs to leave or pass tracking duties, click **Transfer Host** and send the link to the new host.
7. **End & Settle**: Tap **🏁 End Game & Settle**, input final chips for remaining players, check the balance status, and tap **Calculate Settlement ➔**. Then tap **Copy Message** or **WhatsApp Share** to send the final breakdown to your group chat!

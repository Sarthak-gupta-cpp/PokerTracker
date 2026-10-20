/**
 * PokerTracker - Settlement & Debt Simplification Engine
 * Handles leaderboard ranking, discrepancy checks, and greedy debt minimization.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PokerSettlement = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Calculate leaderboard with net earnings and rank icons.
   * @param {Array} players - Array of player objects
   * @param {string} currency - Currency symbol (e.g. '₹', '$')
   * @returns {Array} Sorted array of players with rank, net, and formatted strings
   */
  function calculateLeaderboard(players, currency = '₹') {
    if (!Array.isArray(players) || players.length === 0) return [];

    const enriched = players.map(player => {
      const totalBuyIn = (player.buyIns || []).reduce((sum, b) => sum + (Number(b) || 0), 0);
      const cashOut = Number(player.cashOut) || 0;
      const net = Math.round((cashOut - totalBuyIn) * 100) / 100;

      let netFormatted = '';
      if (net > 0) {
        netFormatted = `+${currency}${net.toLocaleString()}`;
      } else if (net === 0) {
        netFormatted = `${currency}0`;
      } else {
        netFormatted = `−${currency}${Math.abs(net).toLocaleString()}`;
      }

      return {
        id: player.id,
        name: player.name || 'Unnamed Player',
        totalBuyIn,
        cashOut,
        net,
        netFormatted,
        isClockedOut: Boolean(player.clockedOut)
      };
    });

    // Sort descending by net earnings. On tie, sort by totalBuyIn descending.
    enriched.sort((a, b) => {
      if (b.net !== a.net) return b.net - a.net;
      return b.totalBuyIn - a.totalBuyIn;
    });

    // Assign medal ranks or numeric ranks
    return enriched.map((player, index) => {
      let rankIcon = '';
      let rankText = '';
      if (index === 0) {
        rankIcon = '🥇';
        rankText = '1st';
      } else if (index === 1) {
        rankIcon = '🥈';
        rankText = '2nd';
      } else if (index === 2) {
        rankIcon = '🥉';
        rankText = '3rd';
      } else {
        rankIcon = `${index + 1}.`;
        rankText = `${index + 1}th`;
      }

      return {
        ...player,
        rank: index + 1,
        rankIcon,
        rankText
      };
    });
  }

  /**
   * Simplify debts using exact-match pairing followed by greedy flow minimization.
   * @param {Array} players - Array of enriched players with net values
   * @returns {Array} Array of transactions: { from, to, amount }
   */
  function calculateSettlement(players) {
    if (!Array.isArray(players) || players.length < 2) return [];

    // Separate into creditors (won money) and debtors (lost money)
    let creditors = players
      .filter(p => p.net > 0.001)
      .map(p => ({ name: p.name, amount: Math.round(p.net * 100) / 100 }));

    let debtors = players
      .filter(p => p.net < -0.001)
      .map(p => ({ name: p.name, amount: Math.round(Math.abs(p.net) * 100) / 100 }));

    const transactions = [];

    // Pass 1: Try exact 1-to-1 matching to minimize split transfers
    for (let d = 0; d < debtors.length; d++) {
      if (debtors[d].amount <= 0.001) continue;
      for (let c = 0; c < creditors.length; c++) {
        if (creditors[c].amount <= 0.001) continue;
        if (Math.abs(debtors[d].amount - creditors[c].amount) < 0.01) {
          transactions.push({
            from: debtors[d].name,
            to: creditors[c].name,
            amount: debtors[d].amount
          });
          debtors[d].amount = 0;
          creditors[c].amount = 0;
          break;
        }
      }
    }

    // Filter down to remaining active creditors and debtors
    creditors = creditors.filter(c => c.amount > 0.001).sort((a, b) => b.amount - a.amount);
    debtors = debtors.filter(d => d.amount > 0.001).sort((a, b) => b.amount - a.amount);

    // Pass 2: Greedy settlement
    let cIdx = 0;
    let dIdx = 0;

    while (cIdx < creditors.length && dIdx < debtors.length) {
      const creditor = creditors[cIdx];
      const debtor = debtors[dIdx];

      const payment = Math.min(creditor.amount, debtor.amount);
      if (payment > 0.001) {
        transactions.push({
          from: debtor.name,
          to: creditor.name,
          amount: Math.round(payment * 100) / 100
        });
        creditor.amount = Math.round((creditor.amount - payment) * 100) / 100;
        debtor.amount = Math.round((debtor.amount - payment) * 100) / 100;
      }

      if (creditor.amount <= 0.001) cIdx++;
      if (debtor.amount <= 0.001) dIdx++;
    }

    return transactions;
  }

  /**
   * Check total buy-ins vs total cash outs to verify balance.
   */
  function validateBalance(players) {
    let totalBuyIns = 0;
    let totalCashOuts = 0;

    players.forEach(p => {
      totalBuyIns += (p.buyIns || []).reduce((s, b) => s + (Number(b) || 0), 0);
      totalCashOuts += Number(p.cashOut) || 0;
    });

    totalBuyIns = Math.round(totalBuyIns * 100) / 100;
    totalCashOuts = Math.round(totalCashOuts * 100) / 100;
    const diff = Math.round((totalCashOuts - totalBuyIns) * 100) / 100;

    return {
      totalBuyIns,
      totalCashOuts,
      diff,
      isBalanced: Math.abs(diff) < 0.01
    };
  }

  /**
   * Format message in the exact style requested by the user.
   */
  function generateSummaryText({ gameTitle, gameDate, leaderboard, transactions, gameUrl, currency = '₹' }) {
    const lines = [];

    // Header line: 🃏 Tuesday Night Poker · Tuesday, Oct 20 (or 🃏 Tuesday, Oct 20 · Afternoon Poker)
    const headerTitle = gameTitle || 'Poker Night';
    const headerDate = gameDate || new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (headerTitle.toLowerCase().includes(headerDate.toLowerCase()) ||
        (gameDate && headerTitle.toLowerCase().includes(gameDate.toLowerCase()))) {
      lines.push(`🃏 ${headerTitle}`);
    } else {
      lines.push(`🃏 ${headerTitle} · ${headerDate}`);
    }

    // Leaderboard lines:
    // 🥇 Sam  +₹386
    // 🥈 Vidit  +₹370
    // 🥉 Anmol  ₹0
    // 4. Megh  −₹68
    leaderboard.forEach(p => {
      lines.push(`${p.rankIcon} ${p.name}  ${p.netFormatted}`);
    });

    // Game URL if available
    if (gameUrl) {
      lines.push('');
      lines.push(`Game page and leaderboard: ${gameUrl}`);
    }

    // Who owes who section:
    // Who owes who:
    // • Adit → Vidit  ₹314
    // • Ishaan → Sam  ₹200
    if (transactions && transactions.length > 0) {
      lines.push('');
      lines.push('Who owes who:');
      transactions.forEach(t => {
        lines.push(`• ${t.from} → ${t.to}  ${currency}${t.amount.toLocaleString()}`);
      });
    } else {
      lines.push('');
      lines.push('All debts settled evenly! No transfers needed.');
    }

    return lines.join('\n');
  }

  return {
    calculateLeaderboard,
    calculateSettlement,
    validateBalance,
    generateSummaryText
  };
});

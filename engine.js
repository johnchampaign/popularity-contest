// Popularity Contest — shared game engine (ESM)
// Pure functions over a serializable GameState. Used by both
// the browser client and the PartyKit server.

export function makeRng(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

function mk(G, value) { return { id: ++G.nextCardId, value }; }
export function startingHand(G) { return [mk(G, 2), mk(G, 1), mk(G, 0), mk(G, -1), mk(G, -2)]; }
export function cardLabel(v) { return v > 0 ? "+" + v : "" + v; }
export function cardClass(v) {
  if (v === 0) return "zero";
  if (v === 1) return "pos1";
  if (v === 2) return "pos2";
  if (v === -1) return "neg1";
  return "neg2";
}

export function newGame(opts) {
  const seed = (opts.seed >>> 0) || 1;
  const G = {
    seed,
    rngState: seed,
    nextCardId: 0,
    players: [],
    round: 1,
    phase: "popularity",
    pendingAssignments: {},
    currentSubmitter: 0,
    revealData: null,
    log: ["Game start."],
    useDie: !!opts.useDie,
    dieTarget: 6,
    winner: null,
    gamesPlayed: 0,
  };
  G.players = opts.players.map((p, i) => ({
    id: i,
    name: p.name,
    isAI: !!p.isAI,
    aiLevel: p.aiLevel || "heuristic",
    hand: startingHand(G),
    stack: [],
    received: [],
    eliminated: false,
    diePips: opts.useDie ? 1 : null,
  }));
  G.currentSubmitter = firstSubmitter(G);
  return G;
}

export function activePlayers(G) { return G.players.filter(p => !p.eliminated); }

export function firstSubmitter(G) {
  for (let i = 0; i < G.players.length; i++) {
    if (!G.pendingAssignments[i] && (!G.players[i].eliminated || G.players[i].stack.length > 0)) return i;
  }
  return -1;
}
function nextSubmitter(G) {
  for (let i = G.currentSubmitter + 1; i < G.players.length; i++) {
    if (!G.pendingAssignments[i] && (!G.players[i].eliminated || G.players[i].stack.length > 0)) return i;
  }
  return -1;
}

export function submitAssignments(G, fromId, assignments) {
  const p = G.players[fromId];
  if (G.pendingAssignments[fromId]) throw new Error("already submitted");
  if (G.phase !== "popularity") throw new Error("not popularity phase");
  if (p.eliminated) {
    if (p.stack.length === 0) {
      G.pendingAssignments[fromId] = [];
    } else {
      const rng = makeRng(G.rngState ^ (G.round * 7919) ^ (fromId * 31));
      G.rngState = (G.rngState + 1) >>> 0;
      const idx = Math.floor(rng() * p.stack.length);
      const card = p.stack.splice(idx, 1)[0];
      const targets = activePlayers(G);
      if (targets.length === 0 || rng() < 0.25) {
        p.stack.push(card);
        G.pendingAssignments[fromId] = [];
        G.log.push(`(eliminated) ${p.name} kept a card in their stack.`);
      } else {
        const target = pick(targets, rng);
        G.pendingAssignments[fromId] = [{ cardId: card.id, toPlayerId: target.id, card }];
        G.log.push(`(eliminated) ${p.name} played a card on ${target.name}.`);
      }
    }
  } else {
    if (!Array.isArray(assignments)) throw new Error("assignments must be array");
    if (assignments.length > 3) throw new Error("max 3 cards");
    const used = new Set();
    const resolved = [];
    for (const a of assignments) {
      if (used.has(a.cardId)) throw new Error("duplicate card");
      used.add(a.cardId);
      const card = p.hand.find(c => c.id === a.cardId);
      if (!card) throw new Error("card not in hand");
      const target = G.players[a.toPlayerId];
      if (!target || target.eliminated) throw new Error("invalid target");
      resolved.push({ cardId: a.cardId, toPlayerId: a.toPlayerId, card });
    }
    p.hand = p.hand.filter(c => !used.has(c.id));
    G.pendingAssignments[fromId] = resolved;
  }
  if (allSubmitted(G)) enterEvaluation(G);
  else G.currentSubmitter = nextHumanToAct(G);
}

function allSubmitted(G) {
  for (let i = 0; i < G.players.length; i++) {
    if (G.pendingAssignments[i]) continue;
    const p = G.players[i];
    if (!p.eliminated || p.stack.length > 0) return false;
  }
  return true;
}

function nextHumanToAct(G) {
  for (let i = 0; i < G.players.length; i++) {
    if (G.pendingAssignments[i]) continue;
    const p = G.players[i];
    if (p.isAI) continue;
    if (!p.eliminated || p.stack.length > 0) return i;
  }
  // Fall back to any unsubmitted (AIs handled by runAutoTurns)
  return firstSubmitter(G);
}

export function enterEvaluation(G) {
  for (const fromId in G.pendingAssignments) {
    for (const a of G.pendingAssignments[fromId]) {
      G.players[a.toPlayerId].received.push({ ...a.card, from: parseInt(fromId, 10) });
    }
  }
  const active = activePlayers(G);
  const rows = active.map(p => {
    const score = p.received.reduce((s, c) => s + c.value, 0);
    const gotZero = p.received.some(c => c.value === 0);
    return { playerId: p.id, name: p.name, score, gotZero };
  });
  const scores = rows.map(r => r.score);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const lowestPlayers = rows.filter(r => r.score === lo);
  const highestPlayers = rows.filter(r => r.score === hi);
  const eliminated = [];
  if (lowestPlayers.length === 1 && active.length > 1) {
    eliminated.push({ playerId: lowestPlayers[0].playerId, name: lowestPlayers[0].name, reason: "lowest popularity" });
  }
  if (active.length >= 3) {
    const candidates = highestPlayers.filter(r => r.gotZero && !eliminated.find(e => e.playerId === r.playerId));
    if (candidates.length === 1 && lowestPlayers[0]?.playerId !== candidates[0].playerId) {
      eliminated.push({ playerId: candidates[0].playerId, name: candidates[0].name, reason: "received a 0 while most popular" });
    }
  }
  G.revealData = { rows, lo, hi, eliminated };
  G.phase = "evaluation";
  for (const r of rows) G.log.push(`${r.name}: ${r.score >= 0 ? "+" : ""}${r.score}`);
  for (const e of eliminated) G.log.push({ text: `*** ${e.name} eliminated (${e.reason}) ***`, cls: "elim" });
}

export function enterGather(G) {
  if (G.phase !== "evaluation") throw new Error("not evaluation phase");
  const newlyElim = G.revealData.eliminated.map(e => e.playerId);
  for (const p of G.players) {
    if (newlyElim.includes(p.id)) {
      p.eliminated = true;
      p.stack.push(...p.hand, ...p.received);
      p.hand = [];
      p.received = [];
    } else if (!p.eliminated) {
      p.hand.push(...p.received);
      p.received = [];
    } else {
      p.stack.push(...p.received);
      p.received = [];
    }
  }
  G.pendingAssignments = {};
  G.revealData = null;
  const remaining = activePlayers(G);
  if (remaining.length <= 1) {
    G.phase = "gameover";
    G.winner = remaining[0] ? { id: remaining[0].id, name: remaining[0].name } : null;
    if (G.winner) {
      G.log.push({ text: `🏆 ${G.winner.name} wins the game!`, cls: "win" });
      if (G.useDie) {
        const wp = G.players[G.winner.id];
        wp.diePips = Math.min(G.dieTarget, (wp.diePips || 1) + 1);
        if (wp.diePips >= G.dieTarget) {
          G.log.push({ text: `🏆🏆 ${wp.name} reaches ${G.dieTarget} pips — match winner!`, cls: "win" });
        }
      }
    }
    return;
  }
  if (remaining.length === 2) {
    G.log.push({ text: "Two players remain — highest popularity next round wins!", cls: "info" });
  }
  G.round++;
  G.phase = "popularity";
  G.currentSubmitter = firstSubmitter(G);
  G.log.push({ text: `— Round ${G.round} —`, cls: "info" });
}

export function resetForNextMatch(G) {
  for (const p of G.players) {
    p.hand = startingHand(G);
    p.stack = [];
    p.received = [];
    p.eliminated = false;
  }
  G.round = 1;
  G.phase = "popularity";
  G.pendingAssignments = {};
  G.revealData = null;
  G.winner = null;
  G.currentSubmitter = firstSubmitter(G);
  G.gamesPlayed++;
  G.log.push({ text: `=== Game ${G.gamesPlayed + 1} ===`, cls: "info" });
}

// --- AI controller -----------------------------------------
export function aiChoose(G, fromId) {
  const p = G.players[fromId];
  const rng = makeRng(G.rngState ^ (G.round * 1009) ^ (fromId * 17));
  G.rngState = (G.rngState + 1) >>> 0;
  const opponents = activePlayers(G).filter(o => o.id !== fromId);
  const me = p;
  const threatOf = (op) => op.hand.length + op.stack.length * 0.5;
  const sorted = opponents.slice().sort((a, b) => threatOf(b) - threatOf(a));
  const leader = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const myCount = me.hand.length;
  const avgCount = opponents.length ? opponents.reduce((s, o) => s + o.hand.length, 0) / opponents.length : myCount;
  const handByValue = {};
  for (const c of me.hand) (handByValue[c.value] ||= []).push(c);
  const take = (v) => (handByValue[v] && handByValue[v].length) ? handByValue[v].shift() : null;
  const picks = [];
  const activeCount = opponents.length + 1;
  if (activeCount === 2 && opponents.length > 0) {
    const opp = opponents[0];
    const plays = [
      { c: take(2), to: me }, { c: take(1), to: me },
      { c: take(-2), to: opp }, { c: take(-1), to: opp }, { c: take(0), to: opp },
    ].filter(x => x.c);
    for (const pl of plays) { if (picks.length < 3) picks.push({ cardId: pl.c.id, toPlayerId: pl.to.id }); }
  } else if (opponents.length > 0) {
    const candidates = [];
    if (handByValue[-2]?.length) candidates.push({ c: take(-2), to: leader, prio: 9 });
    if (handByValue[0]?.length)  candidates.push({ c: take(0),  to: leader, prio: 8 });
    if (handByValue[-1]?.length) candidates.push({ c: take(-1), to: sorted[1] || leader, prio: 7 });
    const fearLowest = myCount <= avgCount;
    if (handByValue[2]?.length)  candidates.push({ c: take(2),  to: fearLowest ? me : weakest, prio: 6 });
    if (handByValue[1]?.length)  candidates.push({ c: take(1),  to: fearLowest ? me : weakest, prio: 5 });
    candidates.sort((a, b) => b.prio - a.prio);
    for (const c of candidates) {
      if (picks.length >= 3) break;
      picks.push({ cardId: c.c.id, toPlayerId: c.to.id });
    }
  }
  return picks;
}

// --- View redaction: hide private info from other players ---
// Returns a copy of G safe to send to a particular seat.
export function viewFor(G, seatId) {
  if (!G) return null;
  const view = JSON.parse(JSON.stringify(G));
  for (const p of view.players) {
    if (p.id !== seatId) {
      // Hide other players' hand contents (still show count via card backs)
      p.hand = p.hand.map(() => ({ id: 0, value: null, hidden: true }));
      p.stack = p.stack.map(() => ({ id: 0, value: null, hidden: true }));
    }
    // Always hide received cards until evaluation
    if (view.phase !== "evaluation" && view.phase !== "gameover") {
      p.received = p.received.map(() => ({ id: 0, value: null, hidden: true }));
    }
  }
  // Hide pending assignment contents from non-submitters
  const pa = {};
  for (const fromId in view.pendingAssignments) {
    const arr = view.pendingAssignments[fromId];
    if (parseInt(fromId, 10) === seatId) pa[fromId] = arr;
    else pa[fromId] = arr.map(() => ({ hidden: true }));
  }
  view.pendingAssignments = pa;
  return view;
}

// Submit on behalf of every eligible AI / eliminated player. In simultaneous
// mode this happens all at once at the start of each popularity phase. Humans
// can submit in any order; the phase auto-advances when all have submitted.
export function runAutoTurns(G) {
  if (!G || G.phase !== "popularity") return false;
  let progressed = false;
  for (let i = 0; i < G.players.length; i++) {
    if (G.phase !== "popularity") break;
    if (G.pendingAssignments[i]) continue;
    const p = G.players[i];
    if (p.isAI && !p.eliminated) {
      const picks = aiChoose(G, p.id);
      submitAssignments(G, p.id, picks);
      G.log.push({ text: `${p.name} (AI) submitted ${picks.length} card${picks.length === 1 ? "" : "s"}.`, cls: "info" });
      progressed = true;
    } else if (p.eliminated) {
      submitAssignments(G, p.id, []);
      progressed = true;
    }
  }
  return progressed;
}

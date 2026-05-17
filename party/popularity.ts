// PartyKit server for Popularity Contest.
// One "party" instance = one game room. Authoritative on G state.
// Clients (browsers) connect via WebSocket and exchange JSON messages.

import type * as Party from "partykit/server";
// @ts-ignore - JS module, no type declarations
import * as E from "../engine.js";

type Seat = {
  id: number;
  name: string;
  isAI: boolean;
  connId: string | null; // null = empty or AI
  ready: boolean;
};

type RoomConfig = {
  useDie: boolean;
  seed: number;
};

export default class PopularityServer implements Party.Server {
  G: any = null;
  seats: Seat[] = [];
  hostConnId: string | null = null;
  config: RoomConfig = { useDie: true, seed: Math.floor(Math.random() * 1e9) };
  started = false;

  constructor(readonly room: Party.Room) {}

  // --- connection lifecycle ---
  onConnect(conn: Party.Connection) {
    if (!this.hostConnId) this.hostConnId = conn.id;
    this.sync(conn);
  }

  onClose(conn: Party.Connection) {
    if (!this.started) {
      // pre-game: free the seat
      const s = this.seats.find(s => s.connId === conn.id);
      if (s) {
        this.seats = this.seats.filter(x => x !== s);
        // renumber
        this.seats.forEach((x, i) => x.id = i);
      }
    } else {
      // in-game: mark seat as disconnected but keep it (auto-AI fallback)
      const s = this.seats.find(s => s.connId === conn.id);
      if (s) {
        s.connId = null;
        s.isAI = true; // takeover so game doesn't stall
        this.runAutoAndBroadcast();
        return;
      }
    }
    if (this.hostConnId === conn.id) {
      // promote next connection as host
      const conns = [...this.room.getConnections()];
      this.hostConnId = conns[0]?.id ?? null;
    }
    this.broadcast();
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }
    try {
      switch (msg.type) {
        case "join":           return this.onJoin(sender, msg);
        case "add-ai":         return this.hostOnly(sender, () => this.onAddAI(msg));
        case "kick":           return this.hostOnly(sender, () => this.onKick(msg));
        case "toggle-die":     return this.hostOnly(sender, () => { this.config.useDie = !!msg.value; this.broadcast(); });
        case "set-seed":       return this.hostOnly(sender, () => { this.config.seed = (msg.value >>> 0) || 1; this.broadcast(); });
        case "start":          return this.hostOnly(sender, () => this.onStart());
        case "submit":         return this.onSubmit(sender, msg);
        case "continue":       return this.onContinue(sender);
        case "next-match":     return this.hostOnly(sender, () => this.onNextMatch());
        case "reset":          return this.hostOnly(sender, () => this.onReset());
        default:               return this.err(sender, "unknown message type: " + msg.type);
      }
    } catch (e: any) {
      this.err(sender, e?.message || "server error");
    }
  }

  // --- helpers ---
  private hostOnly(sender: Party.Connection, fn: () => void) {
    if (sender.id !== this.hostConnId) return this.err(sender, "host only");
    fn();
  }

  private err(conn: Party.Connection, msg: string) {
    conn.send(JSON.stringify({ type: "error", msg }));
  }

  private seatForConn(connId: string): Seat | undefined {
    return this.seats.find(s => s.connId === connId);
  }

  private sync(conn: Party.Connection) {
    conn.send(JSON.stringify(this.stateFor(conn)));
  }

  private broadcast() {
    for (const conn of this.room.getConnections()) {
      conn.send(JSON.stringify(this.stateFor(conn)));
    }
  }

  private stateFor(conn: Party.Connection) {
    const seat = this.seatForConn(conn.id);
    return {
      type: "state",
      youSeat: seat?.id ?? null,
      youAreHost: conn.id === this.hostConnId,
      roomId: this.room.id,
      seats: this.seats.map(s => ({ id: s.id, name: s.name, isAI: s.isAI, connected: s.connId !== null })),
      config: this.config,
      started: this.started,
      G: this.started && seat ? E.viewFor(this.G, seat.id) :
         (this.started ? E.viewFor(this.G, -1) : null),
    };
  }

  // --- lobby actions ---
  private onJoin(sender: Party.Connection, msg: any) {
    if (this.started) {
      // Allow rejoin to a disconnected seat by name
      const seat = this.seats.find(s => s.name === msg.name && s.connId === null);
      if (seat) {
        seat.connId = sender.id;
        seat.isAI = false; // human resumes control
        this.broadcast();
        return;
      }
      return this.err(sender, "game already started");
    }
    const existing = this.seatForConn(sender.id);
    if (existing) { existing.name = String(msg.name || existing.name).slice(0, 24); this.broadcast(); return; }
    if (this.seats.length >= 8) return this.err(sender, "room full");
    const name = String(msg.name || `Player ${this.seats.length + 1}`).slice(0, 24);
    this.seats.push({
      id: this.seats.length,
      name,
      isAI: false,
      connId: sender.id,
      ready: true,
    });
    this.broadcast();
  }

  private onAddAI(msg: any) {
    if (this.started) throw new Error("already started");
    if (this.seats.length >= 8) throw new Error("room full");
    const name = String(msg.name || `AI ${this.seats.length + 1}`).slice(0, 24);
    this.seats.push({ id: this.seats.length, name, isAI: true, connId: null, ready: true });
    this.broadcast();
  }

  private onKick(msg: any) {
    if (this.started) throw new Error("already started");
    const idx = msg.seatId | 0;
    if (idx < 0 || idx >= this.seats.length) throw new Error("bad seat");
    this.seats.splice(idx, 1);
    this.seats.forEach((s, i) => s.id = i);
    this.broadcast();
  }

  private onStart() {
    if (this.started) throw new Error("already started");
    if (this.seats.length < 3) throw new Error("need at least 3 seats");
    this.G = E.newGame({
      players: this.seats.map(s => ({ name: s.name, isAI: s.isAI })),
      seed: this.config.seed,
      useDie: this.config.useDie,
    });
    this.started = true;
    this.runAutoAndBroadcast();
  }

  private onSubmit(sender: Party.Connection, msg: any) {
    if (!this.started) throw new Error("not started");
    const seat = this.seatForConn(sender.id);
    if (!seat) throw new Error("not seated");
    if (this.G.currentSubmitter !== seat.id) throw new Error("not your turn");
    E.submitAssignments(this.G, seat.id, msg.assignments || []);
    this.runAutoAndBroadcast();
  }

  private onContinue(sender: Party.Connection) {
    if (!this.started) throw new Error("not started");
    if (this.G.phase !== "evaluation") throw new Error("not in evaluation");
    // Any seated player can advance; first click wins.
    E.enterGather(this.G);
    this.runAutoAndBroadcast();
  }

  private onNextMatch() {
    if (!this.started) throw new Error("not started");
    if (this.G.phase !== "gameover") throw new Error("game still in progress");
    E.resetForNextMatch(this.G);
    this.runAutoAndBroadcast();
  }

  private onReset() {
    this.G = null;
    this.started = false;
    this.broadcast();
  }

  private runAutoAndBroadcast() {
    if (this.G) E.runAutoTurns(this.G);
    this.broadcast();
  }
}

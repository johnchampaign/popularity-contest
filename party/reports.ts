// PartyKit HTTP-only party: receives problem reports and files them
// as GitHub issues on this repo. Holds the GitHub PAT as a secret.
//
// Setup once:
//   npx partykit secret put GITHUB_TOKEN
// (paste a fine-grained PAT with Issues + Contents read/write on the repo)

import type * as Party from "partykit/server";

const REPO = "johnchampaign/popularity-contest";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default class ReportsServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    const token = (this.room as any).env?.GITHUB_TOKEN;
    if (!token) return json({ error: "GITHUB_TOKEN not configured on server" }, 500);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

    const desc = String(body.description || "").trim();
    if (!desc) return json({ error: "description required" }, 400);

    const screenshot: string | undefined = body.screenshot;
    const meta = body.meta || {};
    const log: string[] = Array.isArray(body.log) ? body.log : [];
    const state = body.state ?? null;

    let screenshotUrl: string | null = null;
    if (screenshot) {
      try {
        const bytes = b64ToBytes(screenshot);
        const hash = await sha256Hex(bytes);
        const path = `screenshots/${hash}.png`;
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
          method: "PUT",
          headers: ghHeaders(token),
          body: JSON.stringify({
            message: `Screenshot ${hash.slice(0, 8)}`,
            content: screenshot,
          }),
        });
        if (r.ok || (r.status === 422)) {
          // 422 = file already exists (idempotent dedup)
          screenshotUrl = `https://raw.githubusercontent.com/${REPO}/main/${path}`;
        }
      } catch (e) {
        // non-fatal — issue still files without image
      }
    }

    const title = desc.split("\n")[0].slice(0, 80) || "Problem report";
    const sections: string[] = [];
    sections.push("## What happened\n\n" + desc);
    if (body.expected) sections.push("## What I expected\n\n" + String(body.expected));
    if (screenshotUrl) sections.push("## Screenshot\n\n![](" + screenshotUrl + ")");
    sections.push("## Build / context\n\n```json\n" + JSON.stringify(meta, null, 2) + "\n```");
    if (log.length) sections.push("## Last log lines\n\n```\n" + log.slice(-40).join("\n") + "\n```");
    if (state) {
      const stateStr = typeof state === "string" ? state : JSON.stringify(state, null, 2);
      sections.push("## Game state\n\n```json\n" + stateStr.slice(0, 50000) + "\n```");
    }
    const bodyMd = sections.join("\n\n");

    const issueRes = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: ghHeaders(token),
      body: JSON.stringify({ title, body: bodyMd, labels: ["bug", "from-game"] }),
    });
    if (!issueRes.ok) {
      const text = await issueRes.text();
      return json({ error: "github issue create failed", status: issueRes.status, detail: text.slice(0, 500) }, 500);
    }
    const issue: any = await issueRes.json();
    return json({ ok: true, url: issue.html_url, number: issue.number });
  }
}

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function ghHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "popularity-contest-reports",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

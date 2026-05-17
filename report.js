// Client-side problem report helper. Captures a screenshot of the current
// page, shows a modal, POSTs to the PartyKit /reports relay which files a
// GitHub issue with the image, log, and game state embedded.
import html2canvas from "https://esm.sh/html2canvas@1.4.1";

const RELAY = "https://popularity-contest.johnchampaign.partykit.dev/parties/reports/x";
const BUILD = "b5";

export async function openReport({ getState, getLog } = {}) {
  // Capture screenshot BEFORE showing the modal so it shows the bugged state.
  let screenshot = null;
  try {
    const canvas = await html2canvas(document.body, {
      logging: false, useCORS: true, backgroundColor: "#1c1f24",
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
    });
    screenshot = canvas.toDataURL("image/png").split(",")[1];
  } catch (e) {
    console.warn("screenshot capture failed", e);
  }

  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px";
  ov.innerHTML = `
    <div style="background:#262b33;color:#e6e9ef;border:1px solid #5aa9ff;border-radius:10px;padding:18px;max-width:520px;width:100%;max-height:90vh;overflow:auto;font:14px/1.4 system-ui,sans-serif">
      <h2 style="margin:0 0 4px;color:#5aa9ff">🐞 Report a problem</h2>
      <div style="font-size:11px;color:#8a93a3;margin-bottom:10px">Files a public GitHub issue. Don't include sensitive info.</div>
      <label style="display:block;margin-top:6px">What happened?</label>
      <textarea id="_rpt_desc" rows="3" style="width:100%;background:#1c1f24;color:#e6e9ef;border:1px solid #3a414d;border-radius:4px;padding:6px;font:inherit;box-sizing:border-box" autofocus></textarea>
      <label style="display:block;margin-top:6px">What did you expect? (optional)</label>
      <textarea id="_rpt_exp" rows="2" style="width:100%;background:#1c1f24;color:#e6e9ef;border:1px solid #3a414d;border-radius:4px;padding:6px;font:inherit;box-sizing:border-box"></textarea>
      <label style="display:block;margin-top:8px"><input type="checkbox" id="_rpt_shot" ${screenshot ? "checked" : "disabled"}> Include screenshot</label>
      ${screenshot
        ? `<img src="data:image/png;base64,${screenshot}" style="max-width:100%;border:1px solid #3a414d;border-radius:4px;margin-top:4px;display:block">`
        : '<div style="color:#ffb454;font-size:12px;margin-top:4px">⚠ Could not capture screenshot.</div>'}
      <label style="display:block;margin-top:8px"><input type="checkbox" id="_rpt_state" checked> Include game state &amp; log</label>
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
        <button id="_rpt_cancel" style="background:#2f353f;color:#e6e9ef;border:1px solid #3a414d;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit">Cancel</button>
        <button id="_rpt_submit" style="background:#5aa9ff;color:#0a1018;border:none;border-radius:6px;padding:6px 14px;font-weight:600;cursor:pointer;font:inherit">Submit</button>
      </div>
      <div id="_rpt_status" style="margin-top:8px;font-size:12px;min-height:1em"></div>
    </div>`;
  document.body.appendChild(ov);

  const $ = (id) => document.getElementById(id);
  const cleanup = () => ov.remove();
  $("_rpt_cancel").onclick = cleanup;
  ov.addEventListener("click", (e) => { if (e.target === ov) cleanup(); });

  $("_rpt_submit").onclick = async () => {
    const desc = $("_rpt_desc").value.trim();
    if (!desc) { $("_rpt_status").textContent = "Please describe what happened."; return; }
    const exp = $("_rpt_exp").value.trim();
    const includeShot = $("_rpt_shot").checked;
    const includeState = $("_rpt_state").checked;

    const meta = {
      url: location.href,
      userAgent: navigator.userAgent,
      viewport: `${innerWidth}x${innerHeight}`,
      screen: `${screen.width}x${screen.height}`,
      build: BUILD,
      time: new Date().toISOString(),
    };
    const payload = {
      description: desc,
      expected: exp || undefined,
      meta,
      screenshot: (includeShot && screenshot) ? screenshot : undefined,
      state: (includeState && getState) ? safeJson(getState()) : undefined,
      log: (includeState && getLog) ? getLog() : undefined,
    };

    $("_rpt_status").textContent = "Submitting…";
    $("_rpt_submit").disabled = true;
    try {
      const res = await fetch(RELAY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        $("_rpt_status").innerHTML = `✓ Submitted. <a href="${data.url}" target="_blank" rel="noopener" style="color:#5aa9ff">View issue #${data.number} →</a>`;
        setTimeout(cleanup, 6000);
      } else {
        $("_rpt_status").textContent = "Error: " + (data.error || `HTTP ${res.status}`);
        $("_rpt_submit").disabled = false;
      }
    } catch (e) {
      $("_rpt_status").textContent = "Network error: " + e.message;
      $("_rpt_submit").disabled = false;
    }
  };
}

function safeJson(obj) {
  // Trim large/circular blobs by JSON round-trip with size cap.
  try {
    const s = JSON.stringify(obj);
    if (s.length > 200000) return JSON.parse(s.slice(0, 200000)) || s.slice(0, 200000);
    return obj;
  } catch {
    return null;
  }
}

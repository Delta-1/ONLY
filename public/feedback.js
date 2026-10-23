// Small locally synthesized sounds; no audio downloads or third-party requests.
export function createFeedback(preferences) {
  let audio, layer, cleanupTimer, lastClick = 0;
  const celebrated = new Set();
  const allowed = () => !document.hidden && preferences().sound;
  function unlock() {
    if (!allowed()) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      if (!audio || audio.state === "closed") audio = new Context();
      if (audio.state === "suspended") audio.resume().catch(() => {});
    } catch {} // Feedback must never interrupt a payment.
  }
  function tone(frequency, start, duration, volume) {
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(start); oscillator.stop(start + duration + 0.01);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function play(kind) {
    if (!allowed()) return;
    unlock();
    try {
      if (audio?.state !== "running") return;
      const start = audio.currentTime + 0.005;
      if (kind === "sale") {
        [523.25, 659.25, 783.99].forEach((note, i) => tone(note, start + i * 0.085, 0.25, 0.035));
      } else tone(587.33, start, 0.055, 0.018);
    } catch {}
  }
  function clear() {
    clearTimeout(cleanupTimer);
    layer?.remove(); layer = null;
  }
  function success(label) {
    if (!preferences().animations || document.hidden) return;
    clear();
    layer = document.createElement("div");
    layer.className = "sale-feedback-layer";
    layer.setAttribute("popover", "manual");
    const glow = document.createElement("div");
    glow.className = "sale-edge-glow"; glow.setAttribute("aria-hidden", "true");
    const badge = document.createElement("div");
    badge.className = "sale-success-badge";
    badge.setAttribute("role", "status"); badge.setAttribute("aria-live", "polite");
    const icon = document.createElement("span");
    icon.className = "sale-success-check"; icon.textContent = "✓";
    icon.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span"), title = document.createElement("b"), detail = document.createElement("small");
    title.textContent = "OK"; detail.textContent = label;
    copy.append(title, detail); badge.append(icon, copy); layer.append(glow, badge);
    // A top-layer popover stays visible alongside the centered receipt dialog.
    document.body.append(layer);
    try {
      if (!layer.showPopover) throw Error("popover unavailable");
      layer.showPopover();
    } catch {
      layer.removeAttribute("popover");
      (document.querySelector("dialog[open]") || document.body).append(layer);
    }
    cleanupTimer = setTimeout(clear, 2600);
  }
  return {
    unlock,
    click() {
      const now = performance.now();
      if (now - lastClick < 70) return;
      lastClick = now; play("click");
    },
    sale(id, label) {
      if (celebrated.has(id)) return;
      celebrated.add(id);
      if (celebrated.size > 100) celebrated.delete(celebrated.values().next().value);
      play("sale"); success(label);
    },
    preview(label) { play("sale"); success(label); },
    clear,
  };
}

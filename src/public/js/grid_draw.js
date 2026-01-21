const $ = (id) => document.getElementById(id);

const btnStart = $("btnStart");
const btnStop = $("btnStop");
const btnResetUI = $("btnResetUI");

const prizeNameEl = $("prizeName");
const quotaEl = $("quota");

const statusEl = $("status");
const eligibleCountEl = $("eligibleCount");

const winnerMetaEl = $("winnerMeta");
const winnerWallEl = $("winnerWall");

const spotlightEl = $("spotlight");
const spotlightNameEl = $("spotlightName");
const spotlightPrizeEl = $("spotlightPrize");

const overlay = $("drawOverlay");
const countdownEl = $("countdown");
const overlaySubEl = $("overlaySub");
const drawBarEl = $("drawBar");

const confettiCanvas = $("confettiCanvas");
const cctx = confettiCanvas ? confettiCanvas.getContext("2d") : null;

/* ---------------- helpers ---------------- */
function safeSetHTML(el, html) { if (el) el.innerHTML = html; }
function safeSetText(el, txt) { if (el) el.textContent = txt; }
function safeAddClass(el, cls) { if (el) el.classList.add(cls); }
function safeRemoveClass(el, cls) { if (el) el.classList.remove(cls); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getCards() {
  return Array.from(document.querySelectorAll(".name-card"));
}
function getCardById(id) {
  return document.querySelector(`.name-card[data-id="${id}"]`);
}

/* ---------------- overlay ---------------- */
function showOverlay() {
  safeRemoveClass(overlay, "hidden");
  if (drawBarEl) drawBarEl.style.width = "0%";
}
function hideOverlay() {
  safeAddClass(overlay, "hidden");
}

/* ---------------- grid state ---------------- */
function markWon(id) {
  const card = getCardById(id);
  if (!card) return;
  card.classList.add("is-won");
  card.classList.remove("is-eligible");
}
function markWinner(id) {
  const card = getCardById(id);
  if (!card) return;
  card.classList.add("is-winner", "reveal");
  card.classList.add("is-won");
  card.classList.remove("is-eligible");
}

/* ---------------- snapshot + realtime (SSE) ---------------- */
async function syncWinnersSnapshot() {
  try {
    const res = await fetch("/doorprize/api/winners-snapshot");
    const data = await res.json();
    (data.wonIds || []).forEach(markWon);
  } catch (_) {}
}

function startRealtime() {
  const es = new EventSource("/doorprize/api/stream");
  
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "draw_completed") {
        (msg.winners || []).forEach((w) => {
          markWinner(w.id);
          addWinnerCard(0, w.name, w.department, msg.draw?.prize_name || "");
        });

        if (eligibleCountEl) {
          const current = parseInt(eligibleCountEl.textContent || "0", 10);
          if (Number.isFinite(current)) {
            eligibleCountEl.textContent = String(
              Math.max(0, current - (msg.winners?.length || 0))
            );
          }
        }
      }
    } catch (e) {
      console.warn("[SSE] parse error", e);
    }
  };

  es.onerror = (e) => console.warn("[SSE] error / reconnecting...", e);
  return es;
}

/* ---------------- confetti ---------------- */
let confettiParticles = [];

function resizeConfetti() {
  if (!confettiCanvas) return;
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeConfetti);
resizeConfetti();

function confettiBurst(x, y) {
  if (!cctx) return;
  const count = 80;
  for (let i = 0; i < count; i++) {
    confettiParticles.push({
      x, y,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 1.2) * 10,
      g: 0.22 + Math.random() * 0.08,
      life: 70 + Math.floor(Math.random() * 35),
      r: 2 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.25
    });
  }
}

function stepConfetti() {
  if (!cctx || !confettiCanvas) return;
  cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiParticles = confettiParticles.filter((p) => p.life > 0);

  for (const p of confettiParticles) {
    p.life -= 1;
    p.vy += p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vrot;

    cctx.save();
    cctx.translate(p.x, p.y);
    cctx.rotate(p.rot);
    cctx.globalAlpha = Math.max(0, p.life / 100);
    cctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
    cctx.restore();
  }
  requestAnimationFrame(stepConfetti);
}
stepConfetti();

/* ---------------- winner UI ---------------- */
function clearWinnersUI() {
  safeSetHTML(winnerWallEl, "");
  safeSetText(winnerMetaEl, "Belum ada pemenang.");

  safeAddClass(spotlightEl, "hidden");
  safeSetText(spotlightNameEl, "—");
  safeSetText(spotlightPrizeEl, "—");

  // jangan hapus is-won
  getCards().forEach((el) => el.classList.remove("is-winner", "reveal", "sweep", "is-picking", "sweep-strong"));

  safeSetHTML(
    statusEl,
    'Klik <b>START</b> untuk mulai acak (tanpa berhenti), lalu klik <b>STOP</b> untuk keluarkan pemenang.'
  );
}

function showSpotlight(rank, name, department, prize) {
  safeRemoveClass(spotlightEl, "hidden");
  safeSetText(
    spotlightNameEl,
    `${rank}. ${name}${department ? " (" + department + ")" : ""}`
  );
  safeSetText(spotlightPrizeEl, `Hadiah: ${prize}`);
}

function addWinnerCard(rank, name, department, prize) {
  if (!winnerWallEl) return;
  const card = document.createElement("div");
  card.className = "winner-card";
  card.innerHTML = `
    <div class="winner-rank">${rank ? "#" + rank : ""}</div>
    <div class="winner-name">${name}</div>
    ${department ? `<div class="winner-department">${department}</div>` : ""}
    <div class="winner-prize">${prize}</div>
  `;
  winnerWallEl.prepend(card);
}

async function revealWinners(winners, prizeName) {
  hideOverlay();
  safeSetHTML(statusEl, `Hasil undian: <b>${prizeName}</b> — pemenang muncul satu per satu.`);
  safeSetText(winnerMetaEl, `Total pemenang: ${winners.length}`);

  for (let i = 0; i < winners.length; i++) {
    const rank = i + 1;
    const w = winners[i];

    await sleep(160);

    markWinner(w.id);
    showSpotlight(rank, w.name, w.department, prizeName);
    addWinnerCard(rank, w.name, w.department, prizeName);

    confettiBurst(window.innerWidth * 0.78, window.innerHeight * 0.28);
  }
}

/* ---------------- INPUT VALIDATION ---------------- */
function validateInput() {
  const prize_name = String(prizeNameEl?.value || "").trim();
  const quota = parseInt(quotaEl?.value, 10);

  if (!prize_name) return { ok: false, msg: "Nama hadiah wajib diisi." };
  if (!Number.isFinite(quota) || quota < 1) return { ok: false, msg: "Kuota harus angka >= 1." };

  return { ok: true, prize_name, quota };
}

/* ---------------- INFINITE SHUFFLE (RAMAI) ----------------
   - highlight banyak kotak sekaligus
   - stop hanya saat STOP diklik
   - ringan: clear hanya highlight sebelumnya
----------------------------------------------------------- */
let isShuffling = false;
let shuffleRAF = 0;

function shuffleStart() {
  const cards = getCards();
  if (!cards.length) return;

  let prev = [];
  let tick = 0;

  const pickCount = () => {
    // jumlah kotak aktif per frame (rame)
    // contoh:
    // - 50 peserta -> ~8-10
    // - 200 peserta -> ~18-28
    return Math.max(8, Math.min(28, Math.floor(cards.length / 8)));
  };

  const frame = () => {
    if (!isShuffling) {
      prev.forEach((el) => el.classList.remove("sweep-strong", "is-picking"));
      prev = [];
      return;
    }

    tick++;

    // clear highlight sebelumnya saja (ringan)
    prev.forEach((el) => el.classList.remove("sweep-strong", "is-picking"));
    prev = [];

    const n = pickCount();
    const used = new Set();

    // pilih index unik sebanyak n
    while (used.size < n) {
      used.add(Math.floor(Math.random() * cards.length));
    }

    // fase awal lebih “strong”
    const cls = tick < 70 ? "sweep-strong" : "is-picking";

    used.forEach((i) => {
      const el = cards[i];
      // optional: jangan highlight yang sudah menang
      if (el.classList.contains("is-won")) return;
      el.classList.add(cls);
      prev.push(el);
    });

    shuffleRAF = requestAnimationFrame(frame);
  };

  shuffleRAF = requestAnimationFrame(frame);
}

function shuffleStop() {
  isShuffling = false;
  if (shuffleRAF) cancelAnimationFrame(shuffleRAF);
  shuffleRAF = 0;

  // bersihin sisa highlight
  getCards().forEach((c) => c.classList.remove("sweep-strong", "is-picking"));
}

/* ---------------- EVENTS: START / STOP / RESET ---------------- */
btnStart?.addEventListener("click", (e) => {
  e.preventDefault();

  const v = validateInput();
  if (!v.ok) return safeSetText(statusEl, v.msg);

  if (isShuffling) return;

  clearWinnersUI();

  isShuffling = true;
  btnStart.disabled = true;
  if (btnStop) btnStop.disabled = false;

  safeSetHTML(statusEl, `Mengacak terus... klik <b>STOP</b> untuk menentukan pemenang.`);
  shuffleStart();
});

btnStop?.addEventListener("click", async (e) => {
  e.preventDefault();

  const v = validateInput();
  if (!v.ok) return safeSetText(statusEl, v.msg);

  if (!isShuffling) return;

  // STOP shuffle dulu, baru ambil pemenang
  shuffleStop();
  if (btnStop) btnStop.disabled = true;

  // overlay dramatis sebentar
  showOverlay();
  safeSetText(countdownEl, "✓");
  safeSetText(overlaySubEl, "Menentukan pemenang...");
  await sleep(420);

  try {
    const res = await fetch("/doorprize/api/grid-draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prize_name: v.prize_name, quota: v.quota })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      hideOverlay();
      safeSetText(statusEl, data.error || "Undian gagal.");
      btnStart.disabled = false;
      return;
    }

    clearWinnersUI();

    if (eligibleCountEl && typeof data.eligibleCountBefore === "number") {
      eligibleCountEl.textContent = String(
        Math.max(0, data.eligibleCountBefore - v.quota)
      );
    }

    await revealWinners(data.winners || [], data.draw.prize_name);
  } catch (err) {
    console.error(err);
    hideOverlay();
    safeSetText(statusEl, "Terjadi error server.");
  } finally {
    btnStart.disabled = false;
    if (btnStop) btnStop.disabled = true;
  }
});

btnResetUI?.addEventListener("click", (e) => {
  e.preventDefault();

  shuffleStop();

  btnStart.disabled = false;
  if (btnStop) btnStop.disabled = true;

  clearWinnersUI();
});

/* ---------------- init ---------------- */
(async () => {
  clearWinnersUI();
  await syncWinnersSnapshot();
  startRealtime();
})();

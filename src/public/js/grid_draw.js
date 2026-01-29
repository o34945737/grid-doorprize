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

const overlay = $("drawOverlay");
const countdownEl = $("countdown");
const overlaySubEl = $("overlaySub");
const drawBarEl = $("drawBar");

const confettiCanvas = $("confettiCanvas");
const cctx = confettiCanvas ? confettiCanvas.getContext("2d") : null;

/* ✅ spotlight elements */
const spotlightWrap = $("winnerSpotlight");
const spotlightPrizeEl = $("spotlightPrize");
const spotlightRankEl = $("spotlightRank");
const spotlightNameEl = $("spotlightName");
const spotlightDeptEl = $("spotlightDept");

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

/* ---------------- spotlight ---------------- */
function showSpotlight() { safeRemoveClass(spotlightWrap, "hidden"); }
function hideSpotlight() { safeAddClass(spotlightWrap, "hidden"); }

function setSpotlight(rank, name, dept, prizeName){
  safeSetText(spotlightPrizeEl, `Hadiah: ${prizeName}`);
  safeSetText(spotlightRankEl, `#${rank}`);
  safeSetText(spotlightNameEl, name || "—");
  safeSetText(spotlightDeptEl, dept ? dept : " ");
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
let isRevealing = false;

async function syncWinnersSnapshot() {
  try {
    const res = await fetch("/doorprize/api/winners-snapshot");
    const data = await res.json();
    (data.wonIds || []).forEach(markWon);
  } catch (_) {}
}

function startRealtime() {
  const es = new EventSource("/doorprize/api/stream");

  es.onmessage = async (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "draw_completed") {
        // kalau lagi reveal di browser ini, biarin flow local yg handle UI
        // kalau browser lain, minimal markWinner di grid biar sinkron
        if (isRevealing) {
          (msg.winners || []).forEach((w) => markWinner(w.id));
          return;
        }

        // mode realtime normal: mark winners aja (tanpa spam list kanan)
        (msg.winners || []).forEach((w) => markWinner(w.id));

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

/* petasan: burst besar */
function confettiBurst(x, y, power = 1) {
  if (!cctx) return;
  const count = Math.floor(90 * power);
  for (let i = 0; i < count; i++) {
    confettiParticles.push({
      x, y,
      vx: (Math.random() - 0.5) * (12 * power),
      vy: (Math.random() - 1.2) * (12 * power),
      g: 0.22 + Math.random() * 0.08,
      life: 80 + Math.floor(Math.random() * 40),
      r: 2 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.25
    });
  }
}

/* petasan: triple burst */
async function fireCrackers(){
  const cx = window.innerWidth * 0.50;
  const cy = window.innerHeight * 0.36;

  confettiBurst(cx, cy, 1.2);
  await sleep(120);
  confettiBurst(cx - 180, cy + 60, 0.9);
  await sleep(120);
  confettiBurst(cx + 180, cy + 60, 0.9);
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
    cctx.globalAlpha = Math.max(0, p.life / 110);
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

  hideSpotlight();
  safeSetText(spotlightNameEl, "—");
  safeSetText(spotlightPrizeEl, "Hadiah: —");
  safeSetText(spotlightRankEl, "#—");
  safeSetText(spotlightDeptEl, " ");

  getCards().forEach((el) => el.classList.remove("is-winner", "reveal", "sweep", "is-picking", "sweep-strong"));

  safeSetHTML(
    statusEl,
    'Klik <b>START</b> untuk mulai acak (tanpa berhenti), lalu klik <b>STOP</b> untuk keluarkan pemenang.'
  );
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

/* ✅ reveal: tampil di tengah dulu, list kanan belakangan */
async function revealWinners(winners, prizeName) {
  isRevealing = true;

  hideOverlay();
  safeSetHTML(statusEl, `Hasil undian: <b>${prizeName}</b> — pemenang tampil di tengah dulu, lalu masuk list.`);

  safeSetText(winnerMetaEl, `Total pemenang: ${winners.length}`);

  // simpan dulu, nanti render setelah selesai
  const pending = [];

  showSpotlight();

  for (let i = 0; i < winners.length; i++) {
    const rank = i + 1;
    const w = winners[i];

    // highlight grid winner
    markWinner(w.id);

    // tampilkan di tengah
    setSpotlight(rank, w.name, w.department, prizeName);

    // petasan tiap pemenang
    await fireCrackers();

    // tahan sebentar biar kebaca
    await sleep(650);

    // simpan untuk list kanan (commit belakangan)
    pending.push({ rank, name: w.name, department: w.department, prize: prizeName });
  }

  // selesai reveal tengah
  hideSpotlight();

  // baru render list kanan sekaligus
  safeSetHTML(winnerWallEl, "");
  pending.forEach((p) => addWinnerCard(p.rank, p.name, p.department, p.prize));

  isRevealing = false;
}

/* ---------------- INPUT VALIDATION ---------------- */
function validateInput() {
  const prize_name = String(prizeNameEl?.value || "").trim();
  const quota = parseInt(quotaEl?.value, 10);

  if (!prize_name) return { ok: false, msg: "Nama hadiah wajib diisi." };
  if (!Number.isFinite(quota) || quota < 1) return { ok: false, msg: "Kuota harus angka >= 1." };

  return { ok: true, prize_name, quota };
}

/* ---------------- INFINITE SHUFFLE ---------------- */
let isShuffling = false;
let shuffleRAF = 0;

function shuffleStart() {
  const cards = getCards();
  if (!cards.length) return;

  let prev = [];
  let tick = 0;

  const pickCount = () => Math.max(8, Math.min(28, Math.floor(cards.length / 8)));

  const frame = () => {
    if (!isShuffling) {
      prev.forEach((el) => el.classList.remove("sweep-strong", "is-picking"));
      prev = [];
      return;
    }

    tick++;

    prev.forEach((el) => el.classList.remove("sweep-strong", "is-picking"));
    prev = [];

    const n = pickCount();
    const used = new Set();

    while (used.size < n) used.add(Math.floor(Math.random() * cards.length));

    const cls = tick < 70 ? "sweep-strong" : "is-picking";

    used.forEach((i) => {
      const el = cards[i];
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
  getCards().forEach((c) => c.classList.remove("sweep-strong", "is-picking"));
}

/* ---------------- EVENTS ---------------- */
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

  shuffleStop();
  if (btnStop) btnStop.disabled = true;

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

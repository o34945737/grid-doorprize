const $ = (id) => document.getElementById(id);

const btnDraw = $("btnDraw");
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

function safeSetHTML(el, html) {
  if (!el) return;
  el.innerHTML = html;
}
function safeSetText(el, txt) {
  if (!el) return;
  el.textContent = txt;
}
function safeAddClass(el, cls) {
  if (!el) return;
  el.classList.add(cls);
}
function safeRemoveClass(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getCards() {
  return Array.from(document.querySelectorAll(".name-card"));
}
function getCardById(id) {
  return document.querySelector(`.name-card[data-id="${id}"]`);
}
function markWon(id) {
  const card = getCardById(id);
  if (!card) return;
  card.classList.add("is-won");     // sudah menang -> abu/redup
  card.classList.remove("is-eligible");
}

function markWinner(id) {
  const card = getCardById(id);
  if (!card) return;
  card.classList.add("is-winner", "reveal");
  card.classList.add("is-won");     // winner juga dianggap won
  card.classList.remove("is-eligible");
}

// initial sync state (optional tapi recommended)
async function syncWinnersSnapshot() {
  try {
    const res = await fetch("/api/winners-snapshot");
    const data = await res.json();
    (data.wonIds || []).forEach(markWon);
  } catch (_) {}
}

// realtime subscribe (SSE)
function startRealtime() {
  const es = new EventSource("/api/stream");

  es.onopen = () => {
    console.log("[SSE] connected");
  };

  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      // console.log("[SSE] message:", msg);

      if (msg.type === "draw_completed") {
        (msg.winners || []).forEach(w => {
          markWinner(w.id);
          // kalau mau setelah 1 detik pemenang berubah jadi "is-won" (abu) bukan merah terus:
          // setTimeout(() => markWon(w.id), 1200);
        });

        if (eligibleCountEl) {
          const current = parseInt(eligibleCountEl.textContent || "0", 10);
          if (Number.isFinite(current)) {
            eligibleCountEl.textContent = String(Math.max(0, current - (msg.winners?.length || 0)));
          }
        }
      }
    } catch (e) {
      console.warn("[SSE] parse error", e);
    }
  };

  es.onerror = (e) => {
    console.warn("[SSE] error / reconnecting...", e);
  };

  return es;
}



/* ---------- Confetti (simple + ringan) ---------- */
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
      x,
      y,
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

/* ---------- Overlay helpers ---------- */
function showOverlay() {
  safeRemoveClass(overlay, "hidden");
  if (drawBarEl) drawBarEl.style.width = "0%";
}
function hideOverlay() {
  safeAddClass(overlay, "hidden");
}

async function runCountdown() {
  showOverlay();
  safeSetText(overlaySubEl, "Siap-siap ya...");
  for (const n of [3, 2, 1]) {
    safeSetText(countdownEl, String(n));
    await sleep(720);
  }
  safeSetText(countdownEl, "GO!");
  safeSetText(overlaySubEl, "Mengacak nama...");
  await sleep(520);
}

async function runSweepAnimation(durationMs = 2400) {
  const cards = getCards();
  if (!cards.length) return;

  const start = Date.now();
  let lastIndex = -1;

  while (Date.now() - start < durationMs) {
    const t = Math.min(1, (Date.now() - start) / durationMs);
    const idx = Math.floor(Math.random() * cards.length);
    if (idx === lastIndex) continue;
    lastIndex = idx;

    cards.forEach((c) => c.classList.remove("sweep"));
    cards[idx].classList.add("sweep");

    if (drawBarEl) drawBarEl.style.width = `${Math.floor(t * 100)}%`;

   const speed = 45 + Math.floor(t * 110); // akhir bisa ~155ms
   await sleep(speed);
  }

  cards.forEach((c) => c.classList.remove("sweep"));
  if (drawBarEl) drawBarEl.style.width = "100%";
  safeSetText(overlaySubEl, "Menentukan pemenang...");
  await sleep(360);
}

/* ---------- Winner UI ---------- */
function clearWinnersUI() {
  safeSetHTML(winnerWallEl, "");
  safeSetText(winnerMetaEl, "Belum ada pemenang.");

  safeAddClass(spotlightEl, "hidden");
  safeSetText(spotlightNameEl, "—");
  safeSetText(spotlightPrizeEl, "—");

  // hapus animasi/sweep, tapi JANGAN hapus status is-won (biar pemenang lama tetap redup)
  getCards().forEach((el) => el.classList.remove("is-winner", "reveal", "sweep"));

  safeSetHTML(statusEl, 'Klik <b>Mulai Undian</b> untuk mulai animasi dan reveal pemenang.');
}

function showSpotlight(rank, name, prize) {
  safeRemoveClass(spotlightEl, "hidden");
  safeSetText(spotlightNameEl, `${rank}. ${name}`);
  safeSetText(spotlightPrizeEl, `Hadiah: ${prize}`);
}

function addWinnerCard(rank, name, prize) {
  if (!winnerWallEl) return;
  const card = document.createElement("div");
  card.className = "winner-card";
  card.innerHTML = `
    <div class="winner-rank">#${rank}</div>
    <div class="winner-name">${name}</div>
    <div class="winner-prize">${prize}</div>
  `;
  winnerWallEl.prepend(card);
}

async function revealWinners(winners, prizeName) {
  hideOverlay();

  safeSetHTML(statusEl, `Hasil undian: <b>${prizeName}</b> — pemenang akan muncul satu per satu.`);
  safeSetText(winnerMetaEl, `Total pemenang: ${winners.length}`);

  const delayMs = 160;
  for (let i = 0; i < winners.length; i++) {
    const rank = i + 1;
    const w = winners[i];

    await sleep(delayMs);

    const gridCard = getCardById(w.id);
    if (gridCard) gridCard.classList.add("is-winner", "reveal");

    showSpotlight(rank, w.name, prizeName);
    addWinnerCard(rank, w.name, prizeName);

    // confetti posisi kira-kira panel kanan
    confettiBurst(window.innerWidth * 0.78, window.innerHeight * 0.28);
  }
}

/* ---------- Events ---------- */
btnResetUI?.addEventListener("click", () => {
  clearWinnersUI();
});

btnDraw?.addEventListener("click", async () => {
  const prize_name = String(prizeNameEl?.value || "").trim();
  const quota = parseInt(quotaEl?.value, 10);

  if (!prize_name) {
    safeSetText(statusEl, "Nama hadiah wajib diisi.");
    return;
  }
  if (!Number.isFinite(quota) || quota < 1) {
    safeSetText(statusEl, "Kuota harus angka >= 1.");
    return;
  }

  btnDraw.disabled = true;
  safeSetText(statusEl, "Menyiapkan undian...");

  try {
    await runCountdown();
    await runSweepAnimation(2600);

    const res = await fetch("/api/grid-draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prize_name, quota })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      hideOverlay();
      safeSetText(statusEl, data.error || "Undian gagal.");
      btnDraw.disabled = false;
      return;
    }

    clearWinnersUI();

    if (eligibleCountEl && typeof data.eligibleCountBefore === "number") {
      eligibleCountEl.textContent = String(Math.max(0, data.eligibleCountBefore - quota));
    }

    await revealWinners(data.winners || [], data.draw.prize_name);

    btnDraw.disabled = false;
  } catch (e) {
    console.error(e);
    hideOverlay();
    safeSetText(statusEl, "Terjadi error jaringan/server.");
    btnDraw.disabled = false;
  }
});

// init (jangan crash walau beberapa elemen tidak ada)
(async () => {
  clearWinnersUI();
  await syncWinnersSnapshot();   // tarik data pemenang yg sudah ada -> update warna
  startRealtime();               // realtime listen SSE
})();


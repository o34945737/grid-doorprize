const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const btn = document.getElementById("btnSpin");
const resultEl = document.getElementById("result");

let participants = [];
let angle = 0;
let spinning = false;

async function loadData() {
  const res = await fetch("/api/wheel-data");
  const data = await res.json();

  participants = data.participants || [];

  if (!data.isEnough) {
    resultEl.innerHTML = `Hadiah kurang. Peserta tersisa: <b>${data.participantsLeft}</b>, hadiah tersisa: <b>${data.prizeLeft}</b>.`;
    if (btn) btn.disabled = true;
  } else {
    if (btn && !window.__SPIN_DISABLED__) btn.disabled = false;
  }

  drawWheel();
}

function drawWheel() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = 240;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!participants.length) {
    ctx.font = "18px sans-serif";
    ctx.fillText("Tidak ada peserta tersisa.", 150, 260);
    return;
  }

  const slice = (Math.PI * 2) / participants.length;

  for (let i = 0; i < participants.length; i++) {
    const start = angle + i * slice;
    const end = start + slice;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + slice / 2);
    ctx.textAlign = "right";
    ctx.font = "14px sans-serif";
    ctx.fillText(participants[i].name, radius - 12, 5);
    ctx.restore();
  }

  // pointer
  ctx.beginPath();
  ctx.moveTo(cx + radius + 10, cy);
  ctx.lineTo(cx + radius - 10, cy - 10);
  ctx.lineTo(cx + radius - 10, cy + 10);
  ctx.closePath();
  ctx.fill();
}

function normalize(a) {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

// targetIndex: wheel berhenti pada index peserta pemenang
function animateToIndex(targetIndex) {
  const slice = (Math.PI * 2) / participants.length;
  const pointerAngle = 0; // pointer di kanan
  const targetCenter = normalize(pointerAngle - (targetIndex * slice + slice / 2));

  const extraSpins = 6;
  const from = normalize(angle);
  const to = targetCenter + extraSpins * Math.PI * 2;

  const start = performance.now();
  const duration = 2400;

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  spinning = true;

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = easeOutCubic(t);
    angle = from + (to - from) * eased;
    drawWheel();

    if (t < 1) requestAnimationFrame(frame);
    else spinning = false;
  }
  requestAnimationFrame(frame);
}

btn?.addEventListener("click", async () => {
  if (spinning) return;

  if (!participants.length) {
    resultEl.textContent = "Tidak ada peserta tersisa.";
    return;
  }

  btn.disabled = true;
  resultEl.textContent = "Mengundi...";

  const res = await fetch("/api/spin", { method: "POST" });
  const data = await res.json();

  if (data.error) {
    resultEl.textContent = data.error;
    btn.disabled = false;
    return;
  }

  const winnerId = data.participant.id;
  const idx = participants.findIndex(p => p.id === winnerId);

  if (idx >= 0) animateToIndex(idx);

  setTimeout(async () => {
    resultEl.innerHTML = `<b>${data.participant.name}</b> mendapatkan hadiah: <b>${data.prize.prize_name}</b>`;
    await loadData();
    // kalau setelah spin hadiah kurang (seharusnya tidak terjadi karena kita enforce), tombol akan disable di loadData()
  }, 2600);
});

loadData();

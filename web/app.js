const $ = (id) => document.getElementById(id);

const profileEl = $("profile");
const jobDescEl = $("jobDesc");
const questionEl = $("question");
const toneEl = $("tone");
const minWordsEl = $("minWords");
const maxWordsEl = $("maxWords");
const answerEl = $("answer");
const userIdEl = $("userId");
const saveStatusEl = $("saveStatus");
const genStatusEl = $("genStatus");

function getUserId() {
  return (userIdEl.value || "demo-user").trim();
}

// This assumes frontend and API are served from same origin after deployment.
// In local dev, you can point this to your worker URL if needed.
const API_BASE = "";


async function saveProfile() {
  saveStatusEl.textContent = "Saving...";
  try {
    const res = await fetch(`${API_BASE}/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: getUserId(),
        profile: profileEl.value,
      }),
    });

    if (!res.ok) throw new Error(await res.text());

    saveStatusEl.textContent = "Saved.";
  } catch (e) {
    saveStatusEl.textContent = "Save failed. Check console.";
    console.error(e);
  }
}


async function generate() {
  genStatusEl.textContent = "Generating...";
  answerEl.textContent = "";

  try {
    const payload = {
      userId: getUserId(),
      profile: profileEl.value || undefined,
      jobDesc: jobDescEl.value || undefined,
      question: questionEl.value,
      tone: toneEl.value,
      minWords: Number(minWordsEl.value || 100),
      maxWords: Number(maxWordsEl.value || 150),
    };

    const res = await fetch(`${API_BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }

    const data = await res.json();
    answerEl.textContent = data.answer || "";
    genStatusEl.textContent = "Done.";
  } catch (e) {
    genStatusEl.textContent = "Error generating. Check console.";
    console.error(e);
  }
}

async function copyAnswer() {
  const text = answerEl.textContent || "";
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

async function loadProfile() {
  saveStatusEl.textContent = "Loading...";
  try {
    const res = await fetch(`${API_BASE}/profile?userId=${encodeURIComponent(getUserId())}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    profileEl.value = data.profile || "";
    saveStatusEl.textContent = "Loaded.";
  } catch (e) {
    saveStatusEl.textContent = "Load failed.";
    console.error(e);
  }
}

userIdEl.addEventListener("change", loadProfile);
$("saveProfile").addEventListener("click", saveProfile);
$("generate").addEventListener("click", generate);
$("copy").addEventListener("click", copyAnswer);

// Service worker: accumulates per-tab transcripts, persists them across worker
// restarts, and auto-saves a Markdown file when a meeting ends.

const DOWNLOAD_SUBFOLDER = "MeetCaptionExtractor";
const STORAGE_KEY = "mceSessions";

// In-memory mirror of chrome.storage.local[STORAGE_KEY]. Keyed by tabId.
// { [tabId]: { platform, label, startedAt, entries: [{speaker,text,timestamp}] } }
let sessions = {};
let hydrated = false;

async function hydrate() {
  if (hydrated) return;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  sessions = data[STORAGE_KEY] || {};
  hydrated = true;
}

async function persist() {
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
}

function sanitizeSpeakerName(speaker) {
  if (typeof speaker !== "string") return "";
  return speaker.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function fileTimestamp(d) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// Strip characters that are invalid in download filenames.
function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function buildMarkdown(session) {
  const label = session.label || session.platform || "Meeting";
  const title = (session.title || "").trim();
  const start = session.startedAt ? new Date(session.startedAt) : new Date();
  const end = new Date();
  const lines = [];
  lines.push(`# ${title || label + " Transcript"}`);
  lines.push("");
  if (title) lines.push(`- **Meeting:** ${title}`);
  lines.push(`- **Platform:** ${label}`);
  lines.push(`- **Date:** ${start.toLocaleDateString("en-GB")}`);
  lines.push(
    `- **Start:** ${start.toLocaleTimeString("en-GB")}  |  **End:** ${end.toLocaleTimeString("en-GB")}`
  );
  lines.push(`- **Lines:** ${session.entries.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const entry of session.entries) {
    lines.push(`**${entry.speaker}** _(${entry.timestamp})_`);
    lines.push("");
    lines.push(entry.text);
    lines.push("");
  }
  return lines.join("\n");
}

function saveSessionToFile(session) {
  if (!session || !session.entries || session.entries.length === 0) return;
  const md = buildMarkdown(session);
  const base =
    sanitizeFilename(session.title) || session.platform || "meeting";
  const filename = `${DOWNLOAD_SUBFOLDER}/${base}-${fileTimestamp(new Date())}.md`;
  const dataUrl =
    "data:text/markdown;charset=utf-8," + encodeURIComponent(md);
  chrome.downloads.download(
    { url: dataUrl, filename, saveAs: false, conflictAction: "uniquify" },
    () => void chrome.runtime.lastError
  );
}

async function endSession(tabId, { save = true, title } = {}) {
  await hydrate();
  const session = sessions[tabId];
  if (!session) return;
  // Prefer a fresh title captured at leave time (more likely to be loaded).
  if (title) session.title = title;
  if (save) saveSessionToFile(session);
  delete sessions[tabId];
  await persist();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await hydrate();
    const tabId = sender.tab && sender.tab.id;

    if (message.type === "meetingStarted" && tabId != null) {
      sessions[tabId] = {
        platform: message.payload.platform,
        label: message.payload.label,
        title: message.payload.title || "",
        startedAt: Date.now(),
        entries: [],
      };
      await persist();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "newCaption" && tabId != null) {
      const { speaker, text, timestamp, platform } = message.payload;
      const cleanSpeaker = sanitizeSpeakerName(speaker);
      if (!cleanSpeaker || !text) {
        sendResponse({ ok: false });
        return;
      }
      if (!sessions[tabId]) {
        sessions[tabId] = {
          platform: platform || "meeting",
          label: platform || "Meeting",
          startedAt: Date.now(),
          entries: [],
        };
      }
      const entries = sessions[tabId].entries;
      const last = entries.length ? entries[entries.length - 1] : null;
      if (last && last.speaker === cleanSpeaker) {
        last.text = text; // live caption growth for same speaker
      } else {
        entries.push({ speaker: cleanSpeaker, text, timestamp });
      }
      await persist();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "meetingEnded" && tabId != null) {
      await endSession(tabId, { save: true, title: message.payload.title });
      sendResponse({ ok: true });
      return;
    }
  })();
  return true; // keep the message channel open for async sendResponse
});

// If the tab is closed mid-meeting, save whatever we have.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await endSession(tabId, { save: true });
});

// If the tab navigates away from the meeting host (SPA or full nav), flush.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  await hydrate();
  if (!sessions[tabId]) return;
  const url = changeInfo.url;
  const stillInMeeting =
    url.includes("meet.google.com") ||
    url.includes("teams.microsoft.com") ||
    url.includes("teams.cloud.microsoft") ||
    url.includes("teams.live.com");
  if (!stillInMeeting) {
    await endSession(tabId, { save: true });
  }
});

// Platform-specific selectors and actions for caption capture.
// Centralized here because Meet/Teams use obfuscated, frequently-changing markup.
// Exposed on `window.MCE_PLATFORMS` for content.js (same isolated world).

(function () {
  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const meet = {
    id: "meet",
    label: "Google Meet",

    // We are "in a meeting" once the in-call controls (leave button) are present.
    isInMeeting() {
      const leave = Array.from(
        document.querySelectorAll("button[aria-label]")
      ).find((btn) => {
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        return label.includes("leave call") || label.includes("مغادرة");
      });
      return visible(leave);
    },

    // Click "Turn on captions" if captions are not already showing.
    enableCaptions() {
      if (document.querySelector(".nMcdL")) return; // captions already on
      const btn = Array.from(
        document.querySelectorAll("button[aria-label]")
      ).find((b) => {
        const label = b.getAttribute("aria-label") || "";
        return (
          label.includes("تفعيل") ||
          label.toLowerCase().includes("turn on captions")
        );
      });
      if (btn) btn.click();
    },

    // Returns an array of { speaker, text } for the currently rendered captions.
    getCaptions() {
      const out = [];
      const blocks = document.querySelectorAll(".nMcdL");
      for (const block of blocks) {
        const speakerEl = block.querySelector(".NWpY1d");
        const textEl = block.querySelector(".ygicle");
        if (speakerEl && textEl) {
          out.push({
            speaker: speakerEl.textContent.trim(),
            text: textEl.textContent.trim(),
          });
        }
      }
      return out;
    },

    // Meet tab title looks like "Meet - <name>" or "Google Meet". Strip the prefix.
    getMeetingTitle() {
      let t = (document.title || "").trim();
      t = t.replace(/^(Google\s+)?Meet\s*[-–—|:]?\s*/i, "").trim();
      if (!t || /^(Google\s+)?Meet$/i.test(t)) return "";
      return t;
    },
  };

  const TEAMS_SELECTORS = {
    leave:
      "button[data-tid='hangup-main-btn'], button[data-tid='hangup-leave-button'], button[data-tid='hangup-end-meeting-button'], div#hangup-button button, #hangup-button, button[aria-label='Leave' i], button[aria-label*='Leave call' i], button[aria-label*='Hang up' i], button[aria-label*='Sair' i]",
    captionsContainer:
      "[data-tid='closed-caption-v2-window-wrapper'], [data-tid='closed-captions-renderer'], [data-tid*='closed-caption']",
    captionMessage: ".fui-ChatMessageCompact",
    author: "[data-tid='author']",
    captionText: "[data-tid='closed-caption-text']",
    moreButton:
      "button[data-tid='more-button'], button[id='callingButtons-showMoreBtn']",
    languageSpeech: "div[id='LanguageSpeechMenuControl-id']",
    turnOnCaptions: "div[id='closed-captions-button']",
  };

  const teams = {
    id: "teams",
    label: "Microsoft Teams",
    _enableInProgress: false,

    isInMeeting() {
      return visible(document.querySelector(TEAMS_SELECTORS.leave));
    },

    // Three-step menu walk: More -> Language and speech -> Turn on live captions.
    // Async + reentrancy guard because content.js calls this on a loop.
    async enableCaptions() {
      if (document.querySelector(TEAMS_SELECTORS.captionsContainer)) return;
      if (this._enableInProgress) return;
      this._enableInProgress = true;
      try {
        const moreBtn = document.querySelector(TEAMS_SELECTORS.moreButton);
        if (!moreBtn) return;
        moreBtn.click();
        await delay(400);

        const langBtn = document.querySelector(TEAMS_SELECTORS.languageSpeech);
        if (!langBtn) return;
        langBtn.click();
        await delay(400);

        const captionsBtn = document.querySelector(
          TEAMS_SELECTORS.turnOnCaptions
        );
        if (captionsBtn) captionsBtn.click();
      } finally {
        this._enableInProgress = false;
      }
    },

    getCaptions() {
      const out = [];
      const container = document.querySelector(
        TEAMS_SELECTORS.captionsContainer
      );
      if (!container) return out;

      const messages = container.querySelectorAll(
        TEAMS_SELECTORS.captionMessage
      );
      for (const msg of messages) {
        const authorEl = msg.querySelector(TEAMS_SELECTORS.author);
        const textEl = msg.querySelector(TEAMS_SELECTORS.captionText);
        if (!authorEl || !textEl) continue;
        const speaker = authorEl.textContent.trim();
        const text = textEl.textContent.trim();
        if (text) out.push({ speaker: speaker || "Unknown", text });
      }
      return out;
    },

    // Teams tab title looks like "(3) <subject> | Microsoft Teams".
    getMeetingTitle() {
      let t = (document.title || "").trim();
      t = t.replace(/\s*\|\s*Microsoft Teams\s*$/i, "").trim();
      t = t.replace(/^\(\d+\)\s*/, "").trim(); // drop unread badge
      if (!t || /^Microsoft Teams$/i.test(t)) return "";
      return t;
    },
  };

  function detect() {
    const host = location.hostname;
    if (host.includes("meet.google.com")) return meet;
    if (
      host.includes("teams.microsoft.com") ||
      host.includes("teams.cloud.microsoft") ||
      host.includes("teams.live.com")
    ) {
      return teams;
    }
    return null;
  }

  window.MCE_PLATFORMS = { meet, teams, detect };
})();

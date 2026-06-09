// Generic caption-capture engine. Platform behavior comes from platforms.js.
console.log("[MCE] content script loaded on", location.hostname);
if (window.mceContentHasRun) {
  console.warn("[MCE] Already running on this page; this instance will stop.");
} else {
  window.mceContentHasRun = true;

  const platform = window.MCE_PLATFORMS && window.MCE_PLATFORMS.detect();

  if (!platform) {
    console.warn("[MCE] No platform matched for", location.hostname);
  } else {
    console.log("[MCE] Initializing on", platform.label);

    let inMeeting = false;
    let seenCaptions = new Set();
    let captionObserver = null;
    let enableTimer = null;

    function safeSend(message) {
      try {
        chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
      } catch (e) {
        // Extension context invalidated (e.g. reloaded). Ignore.
      }
    }

    function processCaptions() {
      let captions;
      try {
        captions = platform.getCaptions();
      } catch (e) {
        return;
      }
      const now = new Date().toLocaleTimeString("en-GB");
      for (const { speaker, text } of captions) {
        if (!text) continue;
        const key = `${speaker}---${text}`;
        if (seenCaptions.has(key)) continue;
        seenCaptions.add(key);
        safeSend({
          type: "newCaption",
          payload: { speaker, text, timestamp: now, platform: platform.id },
        });
      }
    }

    // Keep trying to turn captions on until they appear.
    // enableCaptions() may be async (Teams walks a 3-step menu), so await it
    // before scheduling the next attempt to avoid overlapping menu clicks.
    function startEnableLoop() {
      stopEnableLoop();
      const tick = async () => {
        if (!inMeeting) return;
        try {
          await platform.enableCaptions();
        } catch (e) {}
        if (!inMeeting) return;
        enableTimer = setTimeout(tick, 2000);
      };
      tick();
    }
    function stopEnableLoop() {
      if (enableTimer) {
        clearTimeout(enableTimer);
        enableTimer = null;
      }
    }

    function startCapture() {
      if (captionObserver) return;
      captionObserver = new MutationObserver(() => processCaptions());
      captionObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      processCaptions();
    }
    function stopCapture() {
      if (captionObserver) {
        captionObserver.disconnect();
        captionObserver = null;
      }
    }

    function onEnterMeeting() {
      if (inMeeting) return;
      inMeeting = true;
      seenCaptions = new Set();
      console.log("[MCE] Meeting started.");
      safeSend({
        type: "meetingStarted",
        payload: { platform: platform.id, label: platform.label },
      });
      startEnableLoop();
      startCapture();
    }

    function onLeaveMeeting() {
      if (!inMeeting) return;
      inMeeting = false;
      console.log("[MCE] Meeting ended.");
      stopEnableLoop();
      stopCapture();
      safeSend({ type: "meetingEnded", payload: { platform: platform.id } });
    }

    // Poll the in-meeting state. Cheap check, runs regardless of captures.
    function checkState() {
      let active = false;
      try {
        active = platform.isInMeeting();
      } catch (e) {}
      if (active && !inMeeting) onEnterMeeting();
      else if (!active && inMeeting) onLeaveMeeting();
    }
    setInterval(checkState, 2000);
    checkState();

    // Safety net: flush on tab/page close.
    window.addEventListener("beforeunload", () => {
      if (inMeeting) {
        inMeeting = false;
        safeSend({ type: "meetingEnded", payload: { platform: platform.id } });
      }
    });
  }
}

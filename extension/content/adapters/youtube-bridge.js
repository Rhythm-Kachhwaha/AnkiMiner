/**
 * AnkiMiner - YouTube Main-World Bridge Script
 * 
 * Runs in the MAIN execution world (page context) on youtube.com to access YouTube's
 * internal player object (#movie_player) and window.ytInitialPlayerResponse.
 * Communicates with AnkiMiner's isolated-world content script via window.postMessage.
 */

(() => {
  if (typeof window === "undefined") return;

  // Prevent duplicate execution if injected multiple times
  if (window.__ANKIMINER_YT_BRIDGE_INITIALIZED__) return;
  window.__ANKIMINER_YT_BRIDGE_INITIALIZED__ = true;

  const SOURCE_MAIN = "ANKIMINER_YT_MAIN";
  const SOURCE_CONTENT = "ANKIMINER_YT_CONTENT";

  function getCaptionTracks() {
    // 1. Check movie_player getPlayerResponse()
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        const resp = player.getPlayerResponse();
        const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(tracks) && tracks.length > 0) {
          return tracks;
        }
      }
    } catch (_) {}

    // 2. Check movie_player getOption('captions', 'tracklist')
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getOption === "function") {
        const tracklist = player.getOption("captions", "tracklist");
        if (Array.isArray(tracklist) && tracklist.length > 0) {
          return tracklist;
        }
      }
    } catch (_) {}

    // 3. Check window.ytInitialPlayerResponse
    try {
      if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const tracks = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (Array.isArray(tracks) && tracks.length > 0) {
          return tracks;
        }
      }
    } catch (_) {}

    return [];
  }

  function broadcastCaptionTracks() {
    const tracks = getCaptionTracks();
    if (tracks && tracks.length > 0) {
      window.postMessage({
        source: SOURCE_MAIN,
        type: "YT_CAPTION_TRACKS",
        tracks
      }, "*");
      return true;
    }
    return false;
  }

  // Poll briefly for player readiness on initial load or SPA navigation
  function probeTracks(attempts = 10, delay = 400) {
    if (broadcastCaptionTracks()) return;
    if (attempts <= 0) return;
    setTimeout(() => probeTracks(attempts - 1, delay), delay);
  }

  // Hook YouTube SPA navigation events
  window.addEventListener("yt-navigate-finish", () => probeTracks());
  window.addEventListener("yt-page-data-updated", () => probeTracks());
  window.addEventListener("load", () => probeTracks());

  // Listen for track requests from isolated-world content script
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source === SOURCE_CONTENT && event.data.type === "REQUEST_YT_CAPTION_TRACKS") {
      probeTracks(5, 300);
    }
  });

  // Initial probe
  probeTracks();
})();

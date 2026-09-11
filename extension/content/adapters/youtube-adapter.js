/**
 * AnkiMiner - YouTube Native Subtitle Extractor Adapter
 * 
 * Automatically detects YouTube caption tracks, extracts Japanese subtitles,
 * converts them to standardized VTT cues, suppresses YouTube's native non-selectable
 * captions, and feeds the cues into AnkiMiner's selectable overlay engine.
 */

(() => {
  function isYouTubePage() {
    if (typeof location === "undefined") return false;
    return location.hostname.includes("youtube.com");
  }

  function normalizeCaptionTrack(rawTrack) {
    if (!rawTrack) return null;
    const lang = (rawTrack.languageCode || "").toLowerCase();
    const name = rawTrack.name?.simpleText ||
      (Array.isArray(rawTrack.name?.runs) ? rawTrack.name.runs.map(r => r.text).join("") : "") ||
      rawTrack.languageCode ||
      "Unknown";
    const isAuto = rawTrack.kind === "asr" || /auto|自動/i.test(name);
    const baseUrl = rawTrack.baseUrl || "";
    const vttUrl = baseUrl
      ? (baseUrl.includes("&fmt=") ? baseUrl.replace(/&fmt=[^&]+/, "&fmt=vtt") : `${baseUrl}&fmt=vtt`)
      : "";

    return {
      languageCode: lang,
      name,
      baseUrl,
      vttUrl,
      isAuto
    };
  }

  function prioritizeTracks(rawTracks) {
    if (!Array.isArray(rawTracks) || rawTracks.length === 0) return [];
    const normalized = rawTracks
      .map(normalizeCaptionTrack)
      .filter(t => t && Boolean(t.baseUrl));

    return normalized.sort((a, b) => {
      const aJa = a.languageCode.startsWith("ja");
      const bJa = b.languageCode.startsWith("ja");
      if (aJa && !bJa) return -1;
      if (!aJa && bJa) return 1;
      if (aJa && bJa) {
        if (!a.isAuto && b.isAuto) return -1;
        if (a.isAuto && !b.isAuto) return 1;
      }
      return 0;
    });
  }

  function extractTracksFromHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== "string") return [];
    try {
      const captionIdx = htmlContent.indexOf('"captionTracks"');
      if (captionIdx !== -1) {
        const bracketStart = htmlContent.indexOf('[', captionIdx);
        if (bracketStart !== -1) {
          let depth = 0;
          let bracketEnd = -1;
          for (let i = bracketStart; i < htmlContent.length; i++) {
            if (htmlContent[i] === '[') depth++;
            else if (htmlContent[i] === ']') {
              depth--;
              if (depth === 0) {
                bracketEnd = i;
                break;
              }
            }
          }
          if (bracketEnd !== -1) {
            const jsonStr = htmlContent.slice(bracketStart, bracketEnd + 1);
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) return parsed;
          }
        }
      }
    } catch (_) {}
    return [];
  }

  function findCaptionTracksInDOM() {
    if (typeof document === "undefined") return [];

    // Vector 1: window.ytInitialPlayerResponse if directly exposed
    if (typeof window !== "undefined" && window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      return window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
    }

    // Vector 2: Inline <script> tags containing ytInitialPlayerResponse or playerCaptionsTracklistRenderer
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const s of scripts) {
      const text = s.textContent || "";
      if (text.includes("playerCaptionsTracklistRenderer") && text.includes("captionTracks")) {
        const tracks = extractTracksFromHtml(text);
        if (tracks.length > 0) return tracks;
      }
    }

    return [];
  }

  async function fetchCaptionVTT(vttUrl) {
    if (!vttUrl) return "";

    // 1. Try background fetch to avoid page CSP restrictions
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const resp = await chrome.runtime.sendMessage({
          type: "FETCH_YOUTUBE_TIMEDTEXT",
          url: vttUrl
        });
        if (resp?.ok && resp.text) {
          return resp.text;
        }
      }
    } catch (_) {}

    // 2. Direct fetch fallback (same-origin on youtube.com)
    try {
      const res = await fetch(vttUrl);
      if (res.ok) {
        return await res.text();
      }
    } catch (_) {}

    return "";
  }

  function hideNativeYouTubeCaptions() {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return;
    if (document.getElementById("ankiminer-hide-yt-captions")) return;

    const style = document.createElement("style");
    style.id = "ankiminer-hide-yt-captions";
    style.textContent = `
      .ytp-caption-window-container,
      .caption-window,
      .ytp-caption-segment {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  class YouTubeAdapter {
    constructor({ onCuesLoaded } = {}) {
      this.onCuesLoaded = onCuesLoaded;
      this.tracks = [];
      this.activeTrack = null;
      this._boundCheck = this.checkAndLoad.bind(this);
      this._boundBridgeMessage = this.handleBridgeMessage.bind(this);
    }

    init() {
      if (!isYouTubePage()) return;

      hideNativeYouTubeCaptions();
      this.checkAndLoad();

      // Listen for YouTube SPA navigation events and bridge messages
      if (typeof window !== "undefined") {
        window.addEventListener("message", this._boundBridgeMessage);
        window.addEventListener("yt-navigate-finish", this._boundCheck);
        window.addEventListener("load", this._boundCheck);
      }

      // Listen for runtime track switch requests
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
          if (message?.type === "SELECT_YOUTUBE_TRACK" && typeof message.trackIndex === "number") {
            this.selectTrack(message.trackIndex);
            sendResponse?.({ ok: true });
            return true;
          }
        });
      }
    }

    async checkAndLoad() {
      if (!isYouTubePage()) return;
      hideNativeYouTubeCaptions();

      // Vector 1: Prompt main-world bridge
      if (typeof window !== "undefined" && typeof window.postMessage === "function") {
        try {
          window.postMessage({
            source: "ANKIMINER_YT_CONTENT",
            type: "REQUEST_YT_CAPTION_TRACKS"
          }, "*");
        } catch (_) {}
      }

      // Vector 2: Fallback to DOM/script inspection
      const rawTracks = findCaptionTracksInDOM();
      if (rawTracks && rawTracks.length > 0) {
        await this.processRawTracks(rawTracks);
      }
    }

    async handleBridgeMessage(event) {
      if (!event || event.source !== window || !event.data) return;
      if (event.data.source === "ANKIMINER_YT_MAIN" && event.data.type === "YT_CAPTION_TRACKS") {
        if (Array.isArray(event.data.tracks) && event.data.tracks.length > 0) {
          await this.processRawTracks(event.data.tracks);
        }
      }
    }

    async processRawTracks(rawTracks) {
      const prioritized = prioritizeTracks(rawTracks);
      if (prioritized.length === 0) return;

      this.tracks = prioritized;

      // Broadcast tracks list to sidepanel
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "YOUTUBE_TRACKS_FOUND",
            tracks: this.tracks.map((t, idx) => ({
              index: idx,
              name: t.name,
              languageCode: t.languageCode,
              isAuto: t.isAuto,
              selected: idx === 0
            }))
          }).catch(() => {});
        }
      } catch (_) {}

      // Auto-load top prioritized track (Japanese prioritized)
      const topTrack = this.tracks[0];
      if (topTrack && topTrack.languageCode.startsWith("ja")) {
        await this.loadTrack(topTrack);
      }
    }

    async selectTrack(index) {
      if (index >= 0 && index < this.tracks.length) {
        await this.loadTrack(this.tracks[index]);
      }
    }

    async loadTrack(track) {
      if (!track || !track.vttUrl) return;
      this.activeTrack = track;

      const vttText = await fetchCaptionVTT(track.vttUrl);
      if (!vttText) return;

      const parser = typeof SubtitleParser !== "undefined"
        ? SubtitleParser
        : (typeof globalThis !== "undefined" ? globalThis.SubtitleParser : null);

      if (!parser) return;

      const cues = parser.parseVTT(vttText);
      if (cues.length > 0 && typeof this.onCuesLoaded === "function") {
        this.onCuesLoaded(cues, track);
      }
    }

    destroy() {
      if (typeof window !== "undefined") {
        window.removeEventListener("message", this._boundBridgeMessage);
        window.removeEventListener("yt-navigate-finish", this._boundCheck);
        window.removeEventListener("load", this._boundCheck);
      }
    }
  }

  const YouTubeModule = {
    isYouTubePage,
    normalizeCaptionTrack,
    prioritizeTracks,
    extractTracksFromHtml,
    findCaptionTracksInDOM,
    fetchCaptionVTT,
    hideNativeYouTubeCaptions,
    YouTubeAdapter
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = YouTubeModule;
  } else {
    globalThis.YouTubeAdapter = YouTubeModule;
  }
})();

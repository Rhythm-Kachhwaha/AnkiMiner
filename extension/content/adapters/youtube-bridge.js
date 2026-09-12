/**
 * AnkiMiner - YouTube Main-World Bridge Script
 * 
 * Runs in the MAIN execution world (page context) on youtube.com to access YouTube's
 * internal player object (#movie_player), window.ytcfg, and player APIs.
 * Communicates with AnkiMiner's isolated-world content script via window.postMessage.
 */

(() => {
  if (typeof window === "undefined") return;

  // Prevent duplicate execution if injected multiple times
  if (window.__ANKIMINER_YT_BRIDGE_INITIALIZED__) return;
  window.__ANKIMINER_YT_BRIDGE_INITIALIZED__ = true;

  const SOURCE_MAIN = "ANKIMINER_YT_MAIN";
  const SOURCE_CONTENT = "ANKIMINER_YT_CONTENT";

  let lastVideoIdDispatched = null;
  let isProbing = false;

  function inferVideoId() {
    const pathname = window.location.pathname || "";
    if (pathname) {
      const pathMatch = /\/(shorts|embed)\/([a-zA-Z0-9_-]+)/.exec(pathname);
      if (pathMatch && pathMatch[2]) {
        return pathMatch[2];
      }
    }
    const params = new URLSearchParams(window.location.search);
    return params.get("v") || null;
  }

  function prepareTimedTextUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl, window.location.href);
      url.searchParams.set("fmt", "srv3");
      const clientName = (typeof window.ytcfg !== "undefined" && typeof window.ytcfg.get === "function")
        ? (window.ytcfg.get("INNERTUBE_CLIENT_NAME") || "WEB")
        : "WEB";
      url.searchParams.set("c", clientName);
      return url.toString();
    } catch (_) {
      return rawUrl;
    }
  }

  function normalizeCaptionTracks(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return [];
    return tracks.map(t => {
      const rawUrl = t.url || t.baseUrl || "";
      const srv3Url = prepareTimedTextUrl(rawUrl);
      const name = t.name?.simpleText ||
        (Array.isArray(t.name?.runs) ? t.name.runs.map(r => r.text).join("") : "") ||
        t.displayName ||
        t.languageName ||
        t.languageCode ||
        "Unknown";
      const isAuto = t.kind === "asr" || /auto|自動/i.test(name);
      return {
        languageCode: (t.languageCode || "").toLowerCase(),
        name,
        baseUrl: rawUrl,
        srv3Url,
        isAuto
      };
    }).filter(t => Boolean(t.srv3Url));
  }

  // Tier 1: Live #movie_player audio & caption tracks
  function getTracksFromMoviePlayer(videoId) {
    try {
      const player = document.getElementById("movie_player");
      if (!player) return null;

      const playerVideoId = (typeof player.getVideoData === "function")
        ? player.getVideoData()?.video_id
        : null;

      if (videoId && playerVideoId && playerVideoId !== videoId) {
        return null;
      }

      const title = (typeof player.getVideoData === "function") ? (player.getVideoData()?.title || "") : "";

      // 1. Check getAudioTrack()?.captionTracks (contains live POT parameters)
      if (typeof player.getAudioTrack === "function") {
        const audioTrack = player.getAudioTrack();
        const captionTracks = audioTrack?.captionTracks;
        if (Array.isArray(captionTracks) && captionTracks.length > 0) {
          return {
            title: title || document.title,
            tracks: normalizeCaptionTracks(captionTracks)
          };
        }
      }

      // 2. Check getOption('captions', 'tracklist')
      if (typeof player.getOption === "function") {
        const tracklist = player.getOption("captions", "tracklist");
        if (Array.isArray(tracklist) && tracklist.length > 0) {
          return {
            title: title || document.title,
            tracks: normalizeCaptionTracks(tracklist)
          };
        }
      }

      // 3. Check getPlayerResponse()
      if (typeof player.getPlayerResponse === "function") {
        const resp = player.getPlayerResponse();
        const captionTracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(captionTracks) && captionTracks.length > 0) {
          return {
            title: resp?.videoDetails?.title || title || document.title,
            tracks: normalizeCaptionTracks(captionTracks)
          };
        }
      }
    } catch (_) {}
    return null;
  }

  // Tier 2: Android InnerTube API query (Bypasses desktop PO token enforcement)
  async function getTracksFromAndroidInnerTube(videoId) {
    if (!videoId) return null;
    if (typeof window.ytcfg === "undefined" || typeof window.ytcfg.get !== "function") return null;

    const apiKey = window.ytcfg.get("INNERTUBE_API_KEY");
    if (!apiKey) return null;

    try {
      const response = await fetch(`https://${window.location.host}/youtubei/v1/player?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "ANDROID",
              clientVersion: "20.10.38",
              hl: window.ytcfg.get("HL") || "ja"
            }
          },
          videoId
        })
      });

      if (!response.ok) return null;

      const payload = await response.json();
      const captionTracks = payload?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
        return {
          title: payload?.videoDetails?.title || document.title,
          tracks: normalizeCaptionTracks(captionTracks)
        };
      }
    } catch (_) {}
    return null;
  }

  // Tier 3: Static ytInitialPlayerResponse in window
  function getTracksFromInitialResponse() {
    try {
      if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const captionTracks = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (Array.isArray(captionTracks) && captionTracks.length > 0) {
          return {
            title: window.ytInitialPlayerResponse?.videoDetails?.title || document.title,
            tracks: normalizeCaptionTracks(captionTracks)
          };
        }
      }
    } catch (_) {}
    return null;
  }

  async function resolveCaptionTracks(videoId) {
    // Tier 1
    const playerResult = getTracksFromMoviePlayer(videoId);
    if (playerResult && playerResult.tracks.length > 0) {
      return playerResult;
    }

    // Tier 2
    const androidResult = await getTracksFromAndroidInnerTube(videoId);
    if (androidResult && androidResult.tracks.length > 0) {
      return androidResult;
    }

    // Tier 3
    const staticResult = getTracksFromInitialResponse();
    if (staticResult && staticResult.tracks.length > 0) {
      return staticResult;
    }

    return null;
  }

  async function probeTracks(attempts = 10, delay = 400) {
    if (isProbing) return;
    isProbing = true;

    try {
      const videoId = inferVideoId();
      if (!videoId) return;

      const result = await resolveCaptionTracks(videoId);
      if (result && result.tracks.length > 0) {
        lastVideoIdDispatched = videoId;
        window.postMessage({
          source: SOURCE_MAIN,
          type: "YT_CAPTION_TRACKS",
          videoId,
          title: result.title,
          tracks: result.tracks
        }, "*");
        return;
      }

      if (attempts > 0) {
        setTimeout(() => {
          isProbing = false;
          probeTracks(attempts - 1, delay);
        }, delay);
        return;
      }
    } catch (_) {
    } finally {
      isProbing = false;
    }
  }

  // Listen for track requests from isolated-world content script
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source === SOURCE_CONTENT && event.data.type === "REQUEST_YT_CAPTION_TRACKS") {
      probeTracks(6, 300);
    }
  });

  // Hook YouTube SPA navigation events
  window.addEventListener("yt-navigate-finish", () => {
    const currentVideoId = inferVideoId();
    if (currentVideoId !== lastVideoIdDispatched) {
      probeTracks(10, 350);
    }
  });

  window.addEventListener("yt-page-data-updated", () => {
    const currentVideoId = inferVideoId();
    if (currentVideoId !== lastVideoIdDispatched) {
      probeTracks(8, 350);
    }
  });

  window.addEventListener("load", () => probeTracks(10, 400));

  // Periodic check to detect SPA navigation / YouTube Shorts scrolling
  setInterval(() => {
    const currentVideoId = inferVideoId();
    if (currentVideoId && currentVideoId !== lastVideoIdDispatched) {
      probeTracks(6, 300);
    }
  }, 500);

  // Initial probe
  probeTracks();
})();

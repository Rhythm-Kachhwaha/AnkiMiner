/**
 * AnkiMiner - Video Mining Mode Proof of Concept (POC)
 * 
 * Objectives:
 * 1. Detect HTML5 <video> elements (in top frame or cross-origin iframes via all_frames: true)
 * 2. Synchronize hardcoded Japanese subtitle cues to video.currentTime
 * 3. Render active cue as a normal, text-selectable DOM overlay on the video
 * 4. Verify Yomitan hover scanning and AnkiMiner text selection capture
 * 5. Native TextTrack experiment for YouTube / generic HTML5
 */

(() => {
  // Prevent duplicate initialization in the same frame
  if (window.__ANKIMINER_VIDEO_POC__) {
    return;
  }

  // Hardcoded test cues covering ~60 seconds
  const TEST_CUES = [
    { startTime: 0,  endTime: 5,  text: "これはテストです" },
    { startTime: 5,  endTime: 10, text: "字幕が同期されています" },
    { startTime: 10, endTime: 15, text: "見間違えた" },
    { startTime: 15, endTime: 22, text: "逃げるな！生きる方が戦いだ！" },
    { startTime: 22, endTime: 28, text: "今日はいい天気ですね" },
    { startTime: 28, endTime: 35, text: "日本語の勉強を続けましょう" },
    { startTime: 35, endTime: 42, text: "アニメを見ながら単語を覚える" },
    { startTime: 42, endTime: 50, text: "約束の場所へ急いで行こう" },
    { startTime: 50, endTime: 60, text: "最後まで諦めないで進むんだ" }
  ];

  // -------------------------------------------------------------
  // Step 1: Video Detector
  // -------------------------------------------------------------
  class VideoDetector {
    constructor(onVideoChanged) {
      this.onVideoChanged = onVideoChanged;
      this.activeVideo = null;
      this.observer = null;
      this._boundCheck = this.checkVideos.bind(this);
    }

    start() {
      this.checkVideos();
      this.observer = new MutationObserver(() => {
        this.checkVideos();
      });
      if (document.body) {
        this.observer.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener("DOMContentLoaded", () => {
          this.checkVideos();
          if (document.body) {
            this.observer.observe(document.body, { childList: true, subtree: true });
          }
        });
      }
      window.addEventListener("resize", this._boundCheck);
    }

    stop() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      window.removeEventListener("resize", this._boundCheck);
    }

    findAllVideos() {
      return Array.from(document.querySelectorAll("video"));
    }

    findPrimaryVideo() {
      const videos = this.findAllVideos().filter(v => {
        // Must be in DOM
        if (!v.isConnected) return false;
        const rect = v.getBoundingClientRect();
        // Discard 0-size invisible tracking videos
        return rect.width > 20 && rect.height > 20;
      });

      if (videos.length === 0) return null;
      if (videos.length === 1) return videos[0];

      // Prioritize currently playing video
      const playing = videos.find(v => !v.paused && !v.ended && v.readyState > 2);
      if (playing) return playing;

      // Otherwise pick largest visible video
      let largest = videos[0];
      let maxArea = 0;
      for (const v of videos) {
        const rect = v.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > maxArea) {
          maxArea = area;
          largest = v;
        }
      }
      return largest;
    }

    checkVideos() {
      const primary = this.findPrimaryVideo();
      if (primary !== this.activeVideo) {
        this.activeVideo = primary;
        if (typeof this.onVideoChanged === "function") {
          this.onVideoChanged(this.activeVideo);
        }
      }
    }

    getVideoState() {
      if (!this.activeVideo) return null;
      return {
        currentTime: this.activeVideo.currentTime,
        duration: this.activeVideo.duration,
        paused: this.activeVideo.paused,
        ended: this.activeVideo.ended,
        videoWidth: this.activeVideo.videoWidth,
        videoHeight: this.activeVideo.videoHeight
      };
    }
  }

  // -------------------------------------------------------------
  // Step 2: Subtitle Synchronizer
  // -------------------------------------------------------------
  class SubtitleSynchronizer {
    constructor(cues = TEST_CUES, onCueChanged) {
      this.cues = Array.isArray(cues) ? cues : [];
      this.onCueChanged = onCueChanged;
      this.currentCue = null;
      this.video = null;
      this.offset = 0.0;
      this._boundSync = this.sync.bind(this);
      this._rafId = null;
      this._boundRaf = this._rafLoop.bind(this);
    }

    setCues(newCues) {
      this.cues = Array.isArray(newCues) ? newCues : [];
      this.currentCue = null;
      this.sync();
    }

    setOffset(offsetSeconds) {
      this.offset = typeof offsetSeconds === "number" ? offsetSeconds : 0.0;
      this.sync();
    }

    attach(video) {
      this.detach();
      if (!video) return;
      this.video = video;
      this.video.addEventListener("timeupdate", this._boundSync);
      this.video.addEventListener("seeked", this._boundSync);
      this.video.addEventListener("play", this._boundSync);
      this.video.addEventListener("pause", this._boundSync);
      this.sync();
      this._startRaf();
    }

    detach() {
      this._stopRaf();
      if (this.video) {
        this.video.removeEventListener("timeupdate", this._boundSync);
        this.video.removeEventListener("seeked", this._boundSync);
        this.video.removeEventListener("play", this._boundSync);
        this.video.removeEventListener("pause", this._boundSync);
        this.video = null;
      }
      this._updateCue(null);
    }

    _startRaf() {
      if (this._rafId === null && typeof window.requestAnimationFrame === "function") {
        this._rafId = window.requestAnimationFrame(this._boundRaf);
      }
    }

    _stopRaf() {
      if (this._rafId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    }

    _rafLoop() {
      if (this.video && !this.video.paused) {
        this.sync();
      }
      if (this.video) {
        this._rafId = window.requestAnimationFrame(this._boundRaf);
      } else {
        this._rafId = null;
      }
    }

    findCueAtTime(currentTime) {
      const effectiveTime = currentTime + this.offset;
      for (const cue of this.cues) {
        if (effectiveTime >= cue.startTime && effectiveTime < cue.endTime) {
          return cue;
        }
      }
      return null;
    }

    sync() {
      if (!this.video) {
        this._updateCue(null);
        return;
      }
      const time = this.video.currentTime;
      const matched = this.findCueAtTime(time);
      this._updateCue(matched);
    }

    _updateCue(cue) {
      const prevKey = this.currentCue ? `${this.currentCue.startTime}-${this.currentCue.endTime}-${this.currentCue.text}` : "";
      const newKey = cue ? `${cue.startTime}-${cue.endTime}-${cue.text}` : "";
      if (prevKey !== newKey) {
        this.currentCue = cue;
        if (typeof this.onCueChanged === "function") {
          this.onCueChanged(cue);
        }
      }
    }
  }

  class SubtitleOverlayRenderer {
    constructor() {
      this.container = null;
      this.subtitleEl = null;
      this.video = null;
      this.resizeObserver = null;
      this.onFileDropped = null;
      this._boundUpdatePosition = this.updatePosition.bind(this);

      this._boundDragOver = (e) => {
        e.preventDefault();
        if (this.subtitleEl) {
          this.subtitleEl.style.borderColor = "#cc785c";
        }
      };
      this._boundDragLeave = () => {
        if (this.subtitleEl) {
          this.subtitleEl.style.borderColor = "rgba(255, 255, 255, 0.15)";
        }
      };
      this._boundDrop = (e) => {
        e.preventDefault();
        if (this.subtitleEl) {
          this.subtitleEl.style.borderColor = "rgba(255, 255, 255, 0.15)";
        }
        const file = e.dataTransfer?.files?.[0];
        if (file && typeof this.onFileDropped === "function") {
          this.onFileDropped(file);
        }
      };
    }

    mount(video) {
      this.unmount();
      if (!video) return;
      this.video = video;

      // Ensure container element exists
      let container = document.getElementById("ankiminer-video-overlay-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "ankiminer-video-overlay-container";
        container.className = "ankiminer-video-overlay-container";
        
        container.style.cssText = [
          "position: fixed !important",
          "display: flex !important",
          "justify-content: center !important",
          "align-items: center !important",
          "pointer-events: none !important",
          "z-index: 2147483647 !important",
          "box-sizing: border-box !important",
          "margin: 0 !important",
          "padding: 0 16px !important",
          "text-align: center !important",
          "transition: opacity 0.15s ease !important"
        ].join("; ");

        const span = document.createElement("span");
        span.id = "ankiminer-video-subtitle";
        span.className = "ankiminer-video-subtitle";
        span.style.cssText = [
          "display: inline-block !important",
          "user-select: text !important",
          "-webkit-user-select: text !important",
          "pointer-events: auto !important",
          "cursor: text !important",
          "color: #ffffff !important",
          "background: rgba(18, 17, 15, 0.85) !important",
          "backdrop-filter: blur(2px) !important",
          "-webkit-backdrop-filter: blur(2px) !important",
          "padding: 6px 14px !important",
          "border-radius: 6px !important",
          "border: 1px solid rgba(255, 255, 255, 0.2) !important",
          "font-family: 'Noto Sans JP', 'Noto Serif JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', Meiryo, sans-serif !important",
          "font-size: 24px !important",
          "font-weight: 500 !important",
          "line-height: 1.4 !important",
          "text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9) !important",
          "max-width: 90% !important",
          "word-break: break-word !important",
          "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important"
        ].join("; ");

        container.appendChild(span);
        this.subtitleEl = span;
        this.container = container;
      } else {
        this.container = container;
        this.subtitleEl = container.querySelector("#ankiminer-video-subtitle");
      }

      // Choose mounting parent: fullscreen element or document.body
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      const targetParent = fsEl || document.body || video.parentElement;
      if (targetParent && this.container.parentElement !== targetParent) {
        targetParent.appendChild(this.container);
      }

      // Attach drag and drop listeners
      if (this.container && typeof this.container.addEventListener === "function") {
        this.container.addEventListener("dragover", this._boundDragOver);
        this.container.addEventListener("dragleave", this._boundDragLeave);
        this.container.addEventListener("drop", this._boundDrop);
      }
      if (this.video && typeof this.video.addEventListener === "function") {
        this.video.addEventListener("dragover", this._boundDragOver);
        this.video.addEventListener("dragleave", this._boundDragLeave);
        this.video.addEventListener("drop", this._boundDrop);
        this.video.addEventListener("timeupdate", this._boundUpdatePosition);
      }

      this.updatePosition();

      // Listen for resizing, scroll, and fullscreen changes
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.updatePosition());
        this.resizeObserver.observe(video);
      }
      window.addEventListener("resize", this._boundUpdatePosition);
      window.addEventListener("scroll", this._boundUpdatePosition, true);
      document.addEventListener("fullscreenchange", this._boundUpdatePosition);
      document.addEventListener("webkitfullscreenchange", this._boundUpdatePosition);
    }

    updatePosition() {
      if (!this.container || !this.video) return;

      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        if (!fsEl.contains(this.container)) {
          fsEl.appendChild(this.container);
        }
        this.container.style.position = "absolute";
        this.container.style.top = "auto";
        this.container.style.bottom = "8%";
        this.container.style.left = "0";
        this.container.style.width = "100%";
        this.container.style.height = "auto";
      } else {
        const targetParent = document.body || this.video.parentElement;
        if (targetParent && this.container.parentElement !== targetParent) {
          targetParent.appendChild(this.container);
        }

        const vRect = this.video.getBoundingClientRect();
        if (vRect.width > 0 && vRect.height > 0) {
          const topOffset = vRect.top + (vRect.height * 0.78);
          this.container.style.position = "fixed";
          this.container.style.top = `${Math.round(topOffset)}px`;
          this.container.style.left = `${Math.round(vRect.left)}px`;
          this.container.style.width = `${Math.round(vRect.width)}px`;
          this.container.style.bottom = "auto";
          this.container.style.height = "auto";

          if (this.subtitleEl) {
            const baseSize = Math.max(16, Math.min(32, Math.round(vRect.width * 0.035)));
            this.subtitleEl.style.fontSize = `${baseSize}px`;
          }
        }
      }
    }

    renderCue(cue) {
      if (!this.subtitleEl || !this.container) return;
      if (cue && cue.text) {
        this.subtitleEl.textContent = cue.text;
        this.updatePosition();
        this.container.style.display = "flex";
        this.container.style.opacity = "1";
        this.container.setAttribute("data-active-cue", cue.text);
      } else {
        this.subtitleEl.textContent = "";
        this.container.style.opacity = "0";
        this.container.style.display = "none";
        this.container.removeAttribute("data-active-cue");
      }
    }

    unmount() {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      window.removeEventListener("resize", this._boundUpdatePosition);
      window.removeEventListener("scroll", this._boundUpdatePosition, true);
      document.removeEventListener("fullscreenchange", this._boundUpdatePosition);
      document.removeEventListener("webkitfullscreenchange", this._boundUpdatePosition);

      if (this.container && typeof this.container.removeEventListener === "function") {
        this.container.removeEventListener("dragover", this._boundDragOver);
        this.container.removeEventListener("dragleave", this._boundDragLeave);
        this.container.removeEventListener("drop", this._boundDrop);
      }
      if (this.video && typeof this.video.removeEventListener === "function") {
        this.video.removeEventListener("dragover", this._boundDragOver);
        this.video.removeEventListener("dragleave", this._boundDragLeave);
        this.video.removeEventListener("drop", this._boundDrop);
        this.video.removeEventListener("timeupdate", this._boundUpdatePosition);
      }

      if (this.container && this.container.parentElement) {
        this.container.parentElement.removeChild(this.container);
      }
      this.container = null;
      this.subtitleEl = null;
      this.video = null;
    }
  }

  // -------------------------------------------------------------
  // Step 4: Native TextTrack Inspector (YouTube / generic)
  // -------------------------------------------------------------
  function inspectNativeTextTracks(video) {
    if (!video) return { supported: false, tracks: [] };
    const trackList = video.textTracks ? Array.from(video.textTracks) : [];
    const domTracks = video.querySelectorAll ? Array.from(video.querySelectorAll("track")) : [];

    const tracksReport = trackList.map((t, idx) => {
      let cueCount = 0;
      let accessible = false;
      let sampleText = "";

      try {
        if (t.cues) {
          cueCount = t.cues.length;
          accessible = true;
          if (cueCount > 0 && t.cues[0]?.text) {
            sampleText = t.cues[0].text;
          }
        }
      } catch (err) {
        accessible = false;
      }

      return {
        index: idx,
        kind: t.kind,
        label: t.label,
        language: t.language,
        mode: t.mode,
        cueCount,
        accessible,
        sampleText
      };
    });

    return {
      supported: Boolean(video.textTracks),
      trackCount: trackList.length,
      domTrackElementCount: domTracks.length,
      tracks: tracksReport
    };
  }

  // -------------------------------------------------------------
  // Step 4.5: Subtitle Navigation Hotkeys Controller
  // -------------------------------------------------------------
  function isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = (target.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (typeof target.getAttribute === "function") {
      const role = target.getAttribute("role");
      if (role === "textbox" || role === "combobox" || role === "searchbox") return true;
      const contentEditable = target.getAttribute("contenteditable");
      if (contentEditable && contentEditable !== "false") return true;
    }
    if (typeof target.closest === "function") {
      const editableAncestor = target.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']");
      if (editableAncestor) return true;
    }
    return false;
  }

  function isNetflixPlatform() {
    const nfMod = typeof NetflixAdapter !== "undefined"
      ? NetflixAdapter
      : (typeof window !== "undefined" ? window.NetflixAdapter : null);
    if (nfMod && typeof nfMod.isNetflixPage === "function") {
      return nfMod.isNetflixPage();
    }
    if (typeof location !== "undefined" && location.hostname) {
      return location.hostname.includes("netflix.com");
    }
    return false;
  }

  class SubtitleHotkeyController {
    constructor({ getVideo, getSyncEngine } = {}) {
      this.getVideo = typeof getVideo === "function" ? getVideo : () => null;
      this.getSyncEngine = typeof getSyncEngine === "function" ? getSyncEngine : () => null;
      this.enabled = true;
      this._boundKeyDown = this.handleKeyDown.bind(this);
      this._isAttached = false;
    }

    attach() {
      if (this._isAttached) return;
      // Phase 8.1 subtitle navigation hotkeys disabled on Netflix
      if (isNetflixPlatform()) return;
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("keydown", this._boundKeyDown, true);
        this._isAttached = true;
      }
    }

    detach() {
      if (!this._isAttached) return;
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("keydown", this._boundKeyDown, true);
        this._isAttached = false;
      }
    }

    handleKeyDown(event) {
      if (!this.enabled) return;
      // Phase 8.1 subtitle navigation hotkeys disabled on Netflix
      if (isNetflixPlatform()) return;
      if (!event) return;

      // Do not trigger when modifier keys (Ctrl, Alt, Meta) are held down
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Do not trigger when typing in editable elements or inputs
      if (isEditableTarget(event.target)) return;
      if (typeof document !== "undefined" && isEditableTarget(document.activeElement)) return;

      const video = this.getVideo();
      if (!video || !video.isConnected) return;

      const key = (event.key || "").toLowerCase();
      const code = event.code || "";

      if (key === "a") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.previousSubtitle();
      } else if (key === "s") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.replaySubtitle();
      } else if (key === "d") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.nextSubtitle();
      } else if (key === " " || code === "Space") {
        // If user is focused on a native button, allow normal button click
        const targetTag = (event.target?.tagName || "").toUpperCase();
        if (targetTag === "BUTTON") return;

        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.togglePlayPause();
      }
    }

    getSortedCues() {
      const syncEngine = this.getSyncEngine();
      if (!syncEngine || !Array.isArray(syncEngine.cues) || syncEngine.cues.length === 0) {
        return [];
      }
      return [...syncEngine.cues].sort((a, b) => a.startTime - b.startTime);
    }

    getActiveCue(sortedCues, effectiveTime) {
      const syncEngine = this.getSyncEngine();
      if (syncEngine?.currentCue) {
        return syncEngine.currentCue;
      }
      if (syncEngine && typeof syncEngine.findCueAtTime === "function") {
        const found = syncEngine.findCueAtTime(effectiveTime - (syncEngine.offset || 0));
        if (found) return found;
      }
      for (const cue of sortedCues) {
        if (effectiveTime >= cue.startTime && effectiveTime < cue.endTime) {
          return cue;
        }
      }
      return null;
    }

    previousSubtitle() {
      const video = this.getVideo();
      if (!video) return;

      const syncEngine = this.getSyncEngine();
      const sortedCues = this.getSortedCues();
      if (sortedCues.length === 0) return;

      const offset = syncEngine?.offset || 0;
      const effectiveTime = video.currentTime + offset;
      const activeCue = this.getActiveCue(sortedCues, effectiveTime);

      if (activeCue) {
        const idx = sortedCues.findIndex(c =>
          c === activeCue ||
          (Math.abs(c.startTime - activeCue.startTime) < 0.001 && c.text === activeCue.text)
        );
        if (idx > 0) {
          this.seekToCue(sortedCues[idx - 1]);
        }
      } else {
        let prevCue = null;
        for (let i = sortedCues.length - 1; i >= 0; i--) {
          if (sortedCues[i].startTime < effectiveTime - 0.05) {
            prevCue = sortedCues[i];
            break;
          }
        }
        if (prevCue) {
          this.seekToCue(prevCue);
        }
      }
    }

    replaySubtitle() {
      const video = this.getVideo();
      if (!video) return;

      const syncEngine = this.getSyncEngine();
      const sortedCues = this.getSortedCues();
      const offset = syncEngine?.offset || 0;
      const effectiveTime = video.currentTime + offset;
      const activeCue = this.getActiveCue(sortedCues, effectiveTime);

      if (activeCue && typeof activeCue.startTime === "number") {
        this.seekToCue(activeCue);
      }
    }

    nextSubtitle() {
      const video = this.getVideo();
      if (!video) return;

      const syncEngine = this.getSyncEngine();
      const sortedCues = this.getSortedCues();
      if (sortedCues.length === 0) return;

      const offset = syncEngine?.offset || 0;
      const effectiveTime = video.currentTime + offset;
      const activeCue = this.getActiveCue(sortedCues, effectiveTime);

      if (activeCue) {
        const idx = sortedCues.findIndex(c =>
          c === activeCue ||
          (Math.abs(c.startTime - activeCue.startTime) < 0.001 && c.text === activeCue.text)
        );
        if (idx >= 0 && idx < sortedCues.length - 1) {
          this.seekToCue(sortedCues[idx + 1]);
        }
      } else {
        const nextCue = sortedCues.find(c => c.startTime > effectiveTime + 0.05);
        if (nextCue) {
          this.seekToCue(nextCue);
        }
      }
    }

    seekToCue(cue) {
      if (!cue || typeof cue.startTime !== "number") return;
      const video = this.getVideo();
      if (!video) return;

      const syncEngine = this.getSyncEngine();
      const offset = syncEngine?.offset || 0;
      const targetTime = Math.max(0, cue.startTime - offset);

      if (typeof video.seek === "function") {
        video.seek(targetTime);
      } else {
        video.currentTime = targetTime;
        try {
          if (typeof Event === "function") {
            video.dispatchEvent(new Event("seeked"));
            video.dispatchEvent(new Event("timeupdate"));
          } else {
            video.dispatchEvent({ type: "seeked" });
            video.dispatchEvent({ type: "timeupdate" });
          }
        } catch (_) {}
      }

      if (syncEngine && typeof syncEngine.sync === "function") {
        syncEngine.sync();
      }
    }

    togglePlayPause() {
      const video = this.getVideo();
      if (!video) return;

      try {
        if (video.paused) {
          const p = video.play();
          if (p && typeof p.catch === "function") {
            p.catch(() => {});
          }
        } else {
          video.pause();
        }
      } catch (_) {}
    }
  }

  // -------------------------------------------------------------
  // Step 5: Video Mining POC Controller
  // -------------------------------------------------------------
  class VideoMiningPOC {
    constructor() {
      this.renderer = new SubtitleOverlayRenderer();
      this.syncEngine = new SubtitleSynchronizer(TEST_CUES, (cue) => {
        this.renderer.renderCue(cue);
        this.broadcastActiveCue(cue);
      });
      this.detector = new VideoDetector((video) => {
        this.onVideoDetected(video);
      });
      this.activeVideo = null;
      this.activeFilename = "";
      this.ytAdapter = null;
      this.netflixAdapter = null;

      this.hotkeyController = new SubtitleHotkeyController({
        getVideo: () => this.activeVideo,
        getSyncEngine: () => this.syncEngine
      });

      // Wire up file drag-and-drop
      this.renderer.onFileDropped = async (file) => {
        await this.handleDroppedFile(file);
      };

      this._boundMessageHandler = this.handleMessage.bind(this);
    }

    async handleDroppedFile(file) {
      if (!file) return;
      try {
        let text = "";
        if (typeof file.text === "function") {
          text = await file.text();
        } else if (typeof FileReader !== "undefined") {
          text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
          });
        }
        const parser = typeof SubtitleParser !== "undefined"
          ? SubtitleParser
          : (typeof globalThis !== "undefined" ? globalThis.SubtitleParser : null);
        if (!parser) return;
        const cues = parser.parseSubtitles(text, file.name);
        if (cues && cues.length > 0) {
          this.syncEngine.setCues(cues);
          this.activeFilename = file.name;
          try {
            if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({
                type: "SUBTITLE_FILE_LOADED",
                filename: file.name
              }).catch(() => {});
            }
          } catch (_) {}
          this.broadcastActiveCue(this.syncEngine.currentCue);
        }
      } catch (err) {
        console.error("[AnkiMiner Video] Failed to read dropped subtitle file:", err);
      }
    }

    broadcastActiveCue(cue) {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "SUBTITLE_CUE_CHANGED",
            cue,
            offset: this.syncEngine.offset
          }).catch(() => {});
        }
      } catch (_) {}
    }

    handleMessage(message, _sender, sendResponse) {
      if (message?.type === "LOAD_SUBTITLE_CUES" && Array.isArray(message.cues)) {
        this.syncEngine.setCues(message.cues);
        if (message.filename) this.activeFilename = message.filename;
        this.broadcastActiveCue(this.syncEngine.currentCue);
        sendResponse?.({ ok: true, cueCount: message.cues.length });
        return true;
      }
      if (message?.type === "CLEAR_SUBTITLES") {
        this.syncEngine.setCues([]);
        this.syncEngine.setOffset(0.0);
        this.activeFilename = "";
        this.renderer.renderCue(null);
        this.broadcastActiveCue(null);
        sendResponse?.({ ok: true });
        return true;
      }
      if (message?.type === "SET_SUBTITLE_OFFSET" && typeof message.offset === "number") {
        this.syncEngine.setOffset(message.offset);
        this.broadcastActiveCue(this.syncEngine.currentCue);
        sendResponse?.({ ok: true, offset: message.offset });
        return true;
      }
      if (message?.type === "GET_VIDEO_STATE") {
        sendResponse?.({
          ok: true,
          hasVideo: Boolean(this.activeVideo),
          videoState: this.detector.getVideoState(),
          offset: this.syncEngine.offset,
          cueCount: this.syncEngine.cues.length,
          activeFilename: this.activeFilename
        });
        return true;
      }
    }

    init() {
      this.detector.start();

      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(this._boundMessageHandler);
      }

      this.hotkeyController.attach();

      // Check for YouTube adapter
      const ytMod = typeof YouTubeAdapter !== "undefined"
        ? YouTubeAdapter
        : (typeof window !== "undefined" ? window.YouTubeAdapter : null);
      if (ytMod && typeof ytMod.YouTubeAdapter === "function" && ytMod.isYouTubePage()) {
        this.ytAdapter = new ytMod.YouTubeAdapter({
          onCuesLoaded: (cues, track) => {
            this.syncEngine.setCues(cues);
            this.activeFilename = `YouTube CC (${track.name || track.languageCode})`;
            try {
              if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                  type: "SUBTITLE_FILE_LOADED",
                  filename: this.activeFilename
                }).catch(() => {});
              }
            } catch (_) {}
            this.broadcastActiveCue(this.syncEngine.currentCue);
          }
        });
        this.ytAdapter.init();
      }

      // Check for Netflix adapter
      const nfMod = typeof NetflixAdapter !== "undefined"
        ? NetflixAdapter
        : (typeof window !== "undefined" ? window.NetflixAdapter : null);
      if (nfMod && typeof nfMod.NetflixAdapter === "function" && nfMod.isNetflixPage()) {
        this.netflixAdapter = new nfMod.NetflixAdapter({
          video: this.activeVideo,
          onCue: (cue) => {
            if (cue) {
              this.activeFilename = "Netflix Subtitles (Live)";
              this.renderer.renderCue(cue);
              this.broadcastActiveCue(cue);
            } else {
              this.renderer.renderCue(null);
              this.broadcastActiveCue(null);
            }
          }
        });
        this.netflixAdapter.init();
      }

      console.log("[AnkiMiner Video POC] Initialized in frame:", typeof window !== "undefined" ? window.location?.href : "");
    }

    onVideoDetected(video) {
      this.activeVideo = video;
      if (this.netflixAdapter && typeof this.netflixAdapter.setVideo === "function") {
        this.netflixAdapter.setVideo(video);
      }
      if (video) {
        console.log("[AnkiMiner Video POC] Primary video detected:", video);
        try {
          const trackReport = inspectNativeTextTracks(video);
          console.log("[AnkiMiner Video POC] Native TextTracks report:", trackReport);
        } catch {}
        this.renderer.mount(video);
        this.syncEngine.attach(video);
      } else {
        console.log("[AnkiMiner Video POC] No active video present.");
        this.syncEngine.detach();
        this.renderer.unmount();
      }
    }

    destroy() {
      if (this.hotkeyController) {
        this.hotkeyController.detach();
      }
      if (this.ytAdapter && typeof this.ytAdapter.destroy === "function") {
        this.ytAdapter.destroy();
        this.ytAdapter = null;
      }
      if (this.netflixAdapter && typeof this.netflixAdapter.destroy === "function") {
        this.netflixAdapter.destroy();
        this.netflixAdapter = null;
      }
      this.detector.stop();
      this.syncEngine.detach();
      this.renderer.unmount();
      this.activeVideo = null;
    }
  }

  // Instantiate and expose for testability/debugging
  const pocInstance = new VideoMiningPOC();
  pocInstance.init();

  window.__ANKIMINER_VIDEO_POC__ = {
    instance: pocInstance,
    TEST_CUES,
    VideoDetector,
    SubtitleSynchronizer,
    SubtitleOverlayRenderer,
    SubtitleHotkeyController,
    isEditableTarget,
    isNetflixPlatform,
    inspectNativeTextTracks
  };
})();

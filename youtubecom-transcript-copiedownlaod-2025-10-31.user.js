// ==UserScript==
// @name         YouTube.com — Transcript Copy & Download (Essential)
// @description  Copy or download the transcript of the current YouTube video with timestamps and basic metadata.
// @version      2025-10-31
// @author       3545.fr
// @namespace    https://3545.fr
// @match        https://*.youtube.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @license      MIT
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const PREFIX = 'SYTER';
    const HOST_ID = `${PREFIX}-button-bar`;
    const BUTTON_IDS = ['copy', 'download'];
    const TIMEDTEXT_MARKER = '/api/timedtext?';
    const YT_HOSTS = new Set([
        'www.youtube.com',
        'youtube.com',
        'youtu.be',
        'm.youtube.com',
        'music.youtube.com'
    ]);
    const TRANSCRIPT_BUTTON_SELECTORS = [
        'button[aria-label*="transcript" i]',
        'button[aria-label*="transcription" i]',
        'tp-yt-paper-item[aria-label*="transcript" i]',
        'tp-yt-paper-item[aria-label*="transcription" i]',
        'yt-formatted-string[aria-label*="transcript" i]',
        'yt-formatted-string[aria-label*="transcription" i]',
    ];
    const TRANSCRIPT_TAB_KEYWORDS = [
        'transcript',
        'transcription',
        'transcripcion',
        'transcricao',
        'transkripsjon',
        'transkript',
        'trascrizione',
    ];

    const state = {
        videoId: null,
        transcriptCache: null,
        buttonRetryTimer: null,
        styleInjected: false,
        poToken: null,
        potCaptureInFlight: null,
        transcriptsByVideo: new Map(),
        transcriptParamsByVideo: new Map(),
        transcriptLanguagesByVideo: new Map(),
    };

    const style = `
        .${PREFIX}-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 6px 12px;
            margin-left: 8px;
            border: 1px solid var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.2));
            border-radius: 16px;
            font: 500 13px/1.4 "Roboto","Arial",sans-serif;
            color: var(--yt-spec-text-primary, #fff);
            background: var(--yt-spec-static-overlay-background-brand, rgba(255, 255, 255, 0.12));
            cursor: pointer;
            transition: background 0.2s ease;
            white-space: nowrap;
        }
        html:not([dark]) .${PREFIX}-btn {
            color: var(--yt-spec-text-primary, #0f0f0f);
            background: rgba(15, 15, 15, 0.08);
            border-color: rgba(15, 15, 15, 0.16);
        }
        .${PREFIX}-btn:hover {
            background: var(--yt-spec-static-overlay-background-brand, rgba(255, 255, 255, 0.24));
        }
        html:not([dark]) .${PREFIX}-btn:hover {
            background: rgba(15, 15, 15, 0.16);
        }
        .${PREFIX}-bar {
            display: flex;
            gap: 8px;
            margin: 12px 0;
            flex-wrap: wrap;
        }
        .${PREFIX}-toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 18px;
            border-radius: 18px;
            font: 500 14px/1.4 "Roboto","Arial",sans-serif;
            color: #fff;
            background: rgba(0, 0, 0, 0.85);
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        .${PREFIX}-toast.--show {
            opacity: 1;
        }
        .${PREFIX}-toast.--error {
            background: rgba(187, 20, 20, 0.9);
        }
    `;

    init();

    function init() {
        log('script ready');
        injectStyleOnce();
        handleNavigation();
        window.addEventListener('yt-navigate-finish', handleNavigation);
        window.addEventListener('yt-page-data-updated', handleNavigation);
    }

    function extractVideoId(fromUrl = window.location.href) {
        if (!fromUrl) return null;
        let input = fromUrl;
        if (!/^https?:\/\//i.test(input)) {
            input = `https://${input}`;
        }
        try {
            const url = new URL(input);
            const host = url.hostname;
            if (!YT_HOSTS.has(host)) return null;

            const path = url.pathname;
            const params = url.searchParams;

            if (host === 'youtu.be') {
                const candidate = path.slice(1);
                return candidate || null;
            }

            if (host.includes('youtube.com')) {
                if (path === '/watch' && params.has('v')) {
                    return params.get('v') || null;
                }
                if (path.startsWith('/embed/') || path.startsWith('/v/')) {
                    return path.split('/')[2] || null;
                }
                if (path.startsWith('/shorts/') || path.startsWith('/live/')) {
                    return path.split('/')[2] || null;
                }
            }
        } catch (error) {
            return null;
        }
        return null;
    }

    function handleNavigation() {
        const videoId = extractVideoId();
        if (!videoId) {
            resetState();
            return;
        }

        if (videoId !== state.videoId) {
            state.videoId = videoId;
        const cachedLines = state.transcriptsByVideo.get(videoId);
        state.transcriptCache = Array.isArray(cachedLines) ? cachedLines : null;
            state.poToken = null;
            state.potCaptureInFlight = null;
            log(`navigated to video ${videoId}`);
        }

        ensureButtons();
    }

    function resetState() {
        state.videoId = null;
        state.transcriptCache = null;
        state.poToken = null;
        state.potCaptureInFlight = null;
        clearTimeout(state.buttonRetryTimer);
        state.buttonRetryTimer = null;
        destroyButtonHost();
    }

    function injectStyleOnce() {
        if (state.styleInjected) return;
        const el = document.createElement('style');
        el.textContent = style;
        document.head.appendChild(el);
        state.styleInjected = true;
    }

    function ensureButtons() {
        const host = ensureButtonHost();
        if (!host) {
            scheduleButtonRetry();
            return;
        }

        if (BUTTON_IDS.every(id => document.getElementById(`${PREFIX}-${id}`))) {
            return;
        }

        clearButtons();
        const copyBtn = createButton('copy', 'Copy transcript', onCopy);
        const downloadBtn = createButton('download', 'Download .txt', onDownload);
        host.appendChild(copyBtn);
        host.appendChild(downloadBtn);

        log('buttons attached');
    }

    function scheduleButtonRetry() {
        clearTimeout(state.buttonRetryTimer);
        state.buttonRetryTimer = setTimeout(() => {
            if (state.videoId) ensureButtons();
        }, 400);
    }

    function ensureButtonHost() {
        let host = document.getElementById(HOST_ID);
        if (host) return host;

        const player = document.querySelector('ytd-watch-flexy #player');
        if (!player || !player.parentNode) return null;

        host = document.createElement('div');
        host.id = HOST_ID;
        host.className = `${PREFIX}-bar`;

        const below = document.querySelector('ytd-watch-flexy #below');
        if (below?.parentNode) {
            below.parentNode.insertBefore(host, below);
        } else {
            player.parentNode.insertBefore(host, player.nextSibling);
        }

        return host;
    }

    function createButton(id, label, handler) {
        const btn = document.createElement('button');
        btn.id = `${PREFIX}-${id}`;
        btn.className = `${PREFIX}-btn`;
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', handler);
        return btn;
    }

    function clearButtons() {
        const host = document.getElementById(HOST_ID);
        if (!host) return;
        BUTTON_IDS.forEach(id => {
            const btn = document.getElementById(`${PREFIX}-${id}`);
            if (btn?.parentNode === host) host.removeChild(btn);
        });
    }

    function destroyButtonHost() {
        const host = document.getElementById(HOST_ID);
        if (!host) return;
        host.remove();
    }

    async function onCopy() {
        try {
            const text = await buildTranscriptText();
            await writeToClipboard(text);
            showToast('Transcript copied.');
        } catch (error) {
            logError('copy failed', error);
            showToast(error.message || 'Unable to copy transcript.', true);
        }
    }

    async function onDownload() {
        try {
            const text = await buildTranscriptText();
            const info = getVideoInfo();
            const fileName = `${sanitize(info.title)}-${sanitize(info.channel)}.txt`;
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Transcript downloaded.');
        } catch (error) {
            logError('download failed', error);
            showToast(error.message || 'Unable to download transcript.', true);
        }
    }

    async function buildTranscriptText() {
        if (!state.videoId) {
            throw new Error('No video detected.');
        }

        const lines = await loadTranscriptLines();
        if (!lines.length) {
            throw new Error('Transcript is empty.');
        }

        const info = getVideoInfo();
        const headerParts = [
            `video-title="${info.title}"`,
            `video-author="${info.channel}"`,
        ];
        if (info.published) {
            headerParts.push(`video-published="${info.published}"`);
        }
        headerParts.push(`video-link="${info.url}"`, '----------------------------------------', '');
        return headerParts.join('\n') + lines.join('\n');
    }

    async function loadTranscriptLines() {
        if (state.transcriptCache) {
            return state.transcriptCache;
        }

        const cached = state.transcriptsByVideo.get(state.videoId);
        if (cached?.length) {
            state.transcriptCache = cached;
            return cached;
        }

        const viaApi = await tryFetchTranscript();
        if (viaApi?.length) {
            state.transcriptCache = viaApi;
            return viaApi;
        }

        const viaDom = await fetchDomTranscript();
        if (viaDom.length) {
            state.transcriptCache = viaDom;
            cacheTranscript(state.videoId, viaDom);
            return viaDom;
        }

        throw new Error('Transcript unavailable.');
    }

    async function tryFetchTranscript() {
        const viaInnertube = await fetchTranscriptFromInnertube(state.videoId);
        if (viaInnertube?.length) {
            return viaInnertube;
        }

        const track = pickCaptionTrack();
        if (!track || !track.baseUrl) {
            return null;
        }

        const baseUrl = track.baseUrl;
        const initialUrls = [];
        const fmtUrl = appendFmt(baseUrl);
        if (fmtUrl) initialUrls.push(fmtUrl);
        initialUrls.push(baseUrl);

        let pot = state.poToken || readPoTokenFromPerformance();
        if (pot) {
            state.poToken = pot;
            initialUrls.unshift(appendPoToken(fmtUrl, pot));
            initialUrls.unshift(appendPoToken(baseUrl, pot));
        }

        let lines = await fetchTranscriptFromUrls(initialUrls);
        if (lines?.length) {
            cacheTranscript(state.videoId, lines);
            return lines;
        }

        pot = await ensurePoToken();
        if (pot) {
            state.poToken = pot;
            const potUrls = [
                appendPoToken(appendFmt(baseUrl), pot),
                appendPoToken(baseUrl, pot),
            ];
            lines = await fetchTranscriptFromUrls(potUrls);
            if (lines?.length) {
                cacheTranscript(state.videoId, lines);
                return lines;
            }
        }

        return null;
    }

    function appendFmt(baseUrl) {
        if (!baseUrl) return baseUrl;
        try {
            const url = new URL(baseUrl);
            if (!url.searchParams.has('fmt')) {
                url.searchParams.set('fmt', 'json3');
            }
            return url.toString();
        } catch {
            if (/[\?&]fmt=/.test(baseUrl)) return baseUrl;
            const separator = baseUrl.includes('?') ? '&' : '?';
            return `${baseUrl}${separator}fmt=json3`;
        }
    }

    function appendPoToken(baseUrl, pot) {
        if (!baseUrl || !pot) return baseUrl;
        try {
            const url = new URL(baseUrl);
            url.searchParams.set('pot', pot);
            return url.toString();
        } catch {
            if (/[\?&]pot=/.test(baseUrl)) return baseUrl;
            const separator = baseUrl.includes('?') ? '&' : '?';
            return `${baseUrl}${separator}pot=${encodeURIComponent(pot)}`;
        }
    }

    function hasTranscriptEvents(data) {
        return !!(data && Array.isArray(data.events) && data.events.length);
    }

    function createLinesFromEvents(events) {
        const lines = [];
        for (const event of events) {
            if (!event?.segs?.length) continue;
            const text = event.segs.map(seg => seg?.utf8 || '').join('').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const time = formatTimestamp((event.tStartMs || 0) / 1000);
            lines.push(`${time} ${text}`);
        }
        return lines;
    }

    function uniqueUrls(urls) {
        const seen = new Set();
        const result = [];
        for (const url of urls) {
            if (!url) continue;
            if (seen.has(url)) continue;
            seen.add(url);
            result.push(url);
        }
        return result;
    }

    function parseTimedTextXml(xmlString) {
        if (typeof DOMParser === 'undefined') {
            return null;
        }
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlString, 'text/xml');
            if (!doc || doc.documentElement?.nodeName?.toLowerCase() === 'parsererror') {
                return null;
            }
            const textNodes = Array.from(doc.getElementsByTagName('text'));
            if (!textNodes.length) return null;

            const events = textNodes.map(node => {
                const startAttr = node.getAttribute('start');
                const tAttr = node.getAttribute('t');
                let startMs = 0;
                if (typeof tAttr === 'string') {
                    const tVal = Number(tAttr);
                    if (Number.isFinite(tVal)) {
                        startMs = Math.round(tVal);
                    }
                } else if (typeof startAttr === 'string') {
                    const startVal = Number(startAttr);
                    if (Number.isFinite(startVal)) {
                        startMs = Math.round(startVal * 1000);
                    }
                }
                const segText = node.textContent?.replace(/\s+/g, ' ').trim() || '';
                return {
                    tStartMs: startMs,
                    segs: [{ utf8: segText }],
                };
            });

            return { events };
        } catch (error) {
            logError('timedtext xml parse error', error);
            return null;
        }
    }

    async function downloadTimedText(url) {
        try {
            const res = await fetch(url, { credentials: 'same-origin' });
            if (!res.ok) {
                logError('timedtext fetch error', new Error(`HTTP ${res.status}`));
                return null;
            }
            const raw = await res.text();
            const cleaned = raw.replace(/^\)\]\}'\s*/, '').trim();
            if (!cleaned) {
                return null;
            }
            const firstChar = cleaned[0];
            if (firstChar === '{' || firstChar === '[') {
                try {
                    return JSON.parse(cleaned);
                } catch (error) {
                    logError('timedtext json parse error', error);
                    return null;
                }
            }
            if (cleaned.startsWith('<')) {
                return parseTimedTextXml(cleaned);
            }
            logError('timedtext parse warning', new Error('Unknown transcript format'));
            return null;
        } catch (error) {
            logError('timedtext fetch error', error);
            return null;
        }
    }

    async function fetchTranscriptFromUrls(urls) {
        const unique = uniqueUrls(urls);
        for (const url of unique) {
            const data = await downloadTimedText(url);
            if (!hasTranscriptEvents(data)) {
                continue;
            }
            const lines = createLinesFromEvents(data.events);
            if (lines.length) {
                return lines;
            }
        }
        return null;
    }

    function pickCaptionTrack() {
        const response = getPlayerResponse();
        const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!Array.isArray(tracks) || tracks.length === 0) return null;

        const preferredLanguage = navigator.language?.toLowerCase();
        const directMatch = preferredLanguage
            ? tracks.find(track => track.languageCode?.toLowerCase() === preferredLanguage)
            : null;
        return directMatch || tracks.find(track => !track.kind) || tracks[0];
    }

    async function ensurePoToken() {
        if (state.poToken) return state.poToken;
        if (state.potCaptureInFlight) return state.potCaptureInFlight;

        const existing = readPoTokenFromPerformance();
        if (existing) {
            state.poToken = existing;
            return existing;
        }

        if (!window.performance || typeof performance.getEntriesByType !== 'function') {
            return null;
        }

        const capture = (async () => {
            const toggle = findSubtitleToggle();
            if (!toggle) return null;

            const initialPressed = toggle.getAttribute('aria-pressed');
            try {
                performance.clearResourceTimings?.();
            } catch (error) {
                // ignore environments that disallow clearing resource timings
            }

            toggle.click();
            await sleep(120);
            toggle.click();

            const pot = await waitForPoToken(1500);

            const currentPressed = toggle.getAttribute('aria-pressed');
            if (initialPressed === 'true' && currentPressed !== 'true') {
                toggle.click();
            } else if (initialPressed !== 'true' && currentPressed === 'true') {
                toggle.click();
            }

            return pot || readPoTokenFromPerformance();
        })();

        state.potCaptureInFlight = capture;
        const result = await capture;
        state.potCaptureInFlight = null;
        if (result) {
            state.poToken = result;
        }
        return result || null;
    }

    function readPoTokenFromPerformance() {
        if (!window.performance || typeof performance.getEntriesByType !== 'function') {
            return null;
        }
        const entries = performance.getEntriesByType('resource');
        for (let i = entries.length - 1; i >= 0; i -= 1) {
            const entry = entries[i];
            if (!entry?.name || typeof entry.name !== 'string') continue;
            if (!entry.name.includes(TIMEDTEXT_MARKER)) continue;
            try {
                const url = new URL(entry.name);
                const pot = url.searchParams.get('pot');
                if (pot) return pot;
            } catch (error) {
                // ignore malformed URLs
            }
        }
        return null;
    }

    function waitForPoToken(timeoutMs = 1500) {
        const deadline = Date.now() + timeoutMs;
        return new Promise(resolve => {
            (function poll() {
                const pot = readPoTokenFromPerformance();
                if (pot) {
                    resolve(pot);
                    return;
                }
                if (Date.now() >= deadline) {
                    resolve(null);
                    return;
                }
                setTimeout(poll, 80);
            })();
        });
    }

    function findSubtitleToggle() {
        return document.querySelector('button.ytp-subtitles-button');
    }

    function getPlayerResponse() {
        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy?.playerResponse) return flexy.playerResponse;
        if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
        try {
            const responseText = document.querySelector('script#ytInitialPlayerResponse')?.textContent;
            if (responseText) return JSON.parse(responseText);
        } catch (error) {
            logError('player response parse error', error);
        }
        return null;
    }

    async function fetchDomTranscript() {
        let nodes = queryTranscriptNodes();
        if (!nodes.length) {
            await openTranscriptPanel();
            await ensureTranscriptTabSelected();
            nodes = await waitForTranscriptNodes(7000);
        } else {
            await ensureTranscriptTabSelected();
        }
        if (!nodes.length) return [];

        const lines = [];
        nodes.forEach(node => {
            const timeEl = node.querySelector('.segment-timestamp, .cue-group-start-offset, .cue-time, .timestamp');
            const textEl = node.querySelector('.segment-text, .cue, .cue-text, yt-formatted-string');
            const time = timeEl?.textContent?.trim();
            const text = textEl?.textContent?.replace(/\s+/g, ' ').trim();
            if (time && text) lines.push(`${time} ${text}`);
        });
        return lines;
    }

    function queryTranscriptNodes() {
        const selectors = [
            'ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer',
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] ytd-transcript-segment-renderer',
            '#segments-container ytd-transcript-segment-renderer',
            'ytd-transcript-renderer .cue-group',
            'yt-transcript-segment-list-renderer yt-transcript-segment-renderer',
            'ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer',
        ];

        for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);
            if (nodes.length) return Array.from(nodes);
        }
        return [];
    }

    async function waitForTranscriptNodes(timeout = 5000) {
        const existing = queryTranscriptNodes();
        if (existing.length) {
            return existing;
        }

        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const nodes = queryTranscriptNodes();
                if (nodes.length) {
                    cleanup();
                    resolve(nodes);
                }
            });

            const timer = setTimeout(() => {
                cleanup();
                resolve(queryTranscriptNodes());
            }, timeout);

            const cleanup = () => {
                observer.disconnect();
                clearTimeout(timer);
            };

            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    async function openTranscriptPanel() {
        const existingNodes = queryTranscriptNodes();
        if (existingNodes.length) return;

        const button = findTranscriptButton();
        if (button) {
            button.click();
            return;
        }

        const overflow = document.querySelector('#menu button[aria-label*="more actions" i], #actions button[aria-label*="more actions" i]');
        if (overflow) {
            overflow.click();
            const item = await waitForTranscriptMenuItem(1500);
            if (item) item.click();
        }
    }

    function findTranscriptButton() {
        for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    function waitForTranscriptMenuItem(timeout = 1500) {
        return waitForElement(() => findTranscriptButton(), timeout);
    }

    async function ensureTranscriptTabSelected() {
        const tablist = await waitForElement(
            () => document.querySelector('chip-bar-view-model[role="tablist"], ytd-transcript-search-panel-renderer [role="tablist"]'),
            2000
        );
        if (!tablist) return;

        const tabs = Array.from(tablist.querySelectorAll('button[role="tab"], tp-yt-paper-tab'));
        if (!tabs.length) return;

        const chapterTab = tabs.find(tab => {
            const label = (tab.getAttribute('aria-label') || tab.textContent || '').trim();
            if (!label) return false;
            const normalized = normalizeString(label);
            return normalized.includes('chapitre')
                || normalized.includes('chapters')
                || normalized.includes('chapter')
                || normalized.includes('capit')
                || normalized.includes('kapitel');
        });

        const transcriptTab = tabs.find(tab => {
            const label = (tab.getAttribute('aria-label') || tab.textContent || '').trim();
            if (!label) return false;
            const normalized = normalizeString(label);
            return TRANSCRIPT_TAB_KEYWORDS.some(keyword => normalized.includes(keyword));
        });

        if (chapterTab && transcriptTab && transcriptTab.getAttribute('aria-selected') !== 'true') {
            chapterTab.click();
            await sleep(800);
            transcriptTab.click();
            await sleep(300);
        } else if (transcriptTab && transcriptTab.getAttribute('aria-selected') !== 'true') {
            transcriptTab.click();
            await sleep(120);
        }
    }

    async function fetchTranscriptFromInnertube(videoId) {
        if (!videoId) return null;

        const params = await ensureTranscriptParams(videoId);
        if (!params) return null;

        const apiKey = getInnertubeApiKey();
        const context = getInnertubeContext();
        if (!apiKey || !context) return null;

        const headers = getInnertubeHeaders();

        try {
            const triedParams = new Set();
            triedParams.add(params);

            const first = await requestInnertubeTranscript(apiKey, context, headers, params);
            if (first) {
                if (first.defaultParam) {
                    storeTranscriptParam(videoId, first.defaultParam);
                }
                if (first.languageParams.length) {
                    state.transcriptLanguagesByVideo.set(videoId, first.languageParams);
                    if (state.transcriptLanguagesByVideo.size > 6) {
                        const oldestLangKey = state.transcriptLanguagesByVideo.keys().next().value;
                        if (oldestLangKey && oldestLangKey !== videoId) {
                            state.transcriptLanguagesByVideo.delete(oldestLangKey);
                        }
                    }
                    first.languageParams.forEach(item => {
                        if (item.selected && item.params) {
                            storeTranscriptParam(videoId, item.params);
                        }
                    });
                }
                if (first.lines.length) {
                    cacheTranscript(videoId, first.lines);
                    state.transcriptCache = first.lines;
                    return first.lines;
                }

                for (const item of first.languageParams) {
                    if (!item?.params || triedParams.has(item.params)) continue;
                    triedParams.add(item.params);
                    const alt = await requestInnertubeTranscript(apiKey, context, headers, item.params);
                    if (!alt) continue;
                    if (alt.defaultParam) {
                        storeTranscriptParam(videoId, alt.defaultParam);
                    }
                    if (alt.lines.length) {
                        cacheTranscript(videoId, alt.lines);
                        state.transcriptCache = alt.lines;
                        return alt.lines;
                    }
                }

                const cachedLanguages = state.transcriptLanguagesByVideo.get(videoId) || [];
                for (const item of cachedLanguages) {
                    if (!item?.params || triedParams.has(item.params)) continue;
                    triedParams.add(item.params);
                    const alt = await requestInnertubeTranscript(apiKey, context, headers, item.params);
                    if (!alt) continue;
                    if (alt.defaultParam) {
                        storeTranscriptParam(videoId, alt.defaultParam);
                    }
                    if (alt.lines.length) {
                        cacheTranscript(videoId, alt.lines);
                        state.transcriptCache = alt.lines;
                        return alt.lines;
                    }
                }
            }
        } catch (error) {
            logError('innertube fetch error', error);
        }

        return null;
    }

    async function ensureTranscriptParams(videoId) {
        if (!videoId) return null;

        const existing = state.transcriptParamsByVideo.get(videoId);
        if (existing) return existing;

        const fromInitial = findTranscriptParamInObject(window.ytInitialData) || findTranscriptParamInObject(window.__ytInitialData);
        if (fromInitial) {
            const decoded = decodeParam(fromInitial);
            storeTranscriptParam(videoId, decoded);
            return decoded;
        }

        const fromDocument = extractTranscriptParamFromDocument();
        if (fromDocument) {
            storeTranscriptParam(videoId, fromDocument);
            return fromDocument;
        }

        const fromFetch = await fetchTranscriptParamFromWatch(videoId);
        if (fromFetch) {
            storeTranscriptParam(videoId, fromFetch);
            return fromFetch;
        }

        return null;
    }

    function parseTranscriptResponse(data) {
        const result = {
            lines: [],
            defaultParam: null,
            languageParams: [],
        };

        const panels = collectTranscriptPanels(data);
        panels.forEach(panel => {
            if (!panel || typeof panel !== 'object') return;

            const renderer = panel.transcriptSearchPanelRenderer || panel.transcriptRenderer || panel;
            if (!renderer || typeof renderer !== 'object') return;

            const header = renderer.header?.transcriptSearchBoxRenderer;
            const headerParam = header?.onTextChangeCommand?.getTranscriptEndpoint?.params;
            if (headerParam && !result.defaultParam) {
                result.defaultParam = decodeParam(headerParam);
            }

            const bodyRenderer = renderer.body?.transcriptSegmentListRenderer
                || renderer.transcriptSegmentListRenderer
                || renderer.segmentListRenderer
                || renderer;
            const segments = bodyRenderer?.segments || bodyRenderer?.initialSegments || [];
            segments.forEach(item => {
                const segRenderer = item?.transcriptSegmentRenderer
                    || item?.transcriptSearchPanelSegmentRenderer?.segment
                    || item?.segment
                    || item;
                if (!segRenderer || typeof segRenderer !== 'object') return;
                const startMs = Number(segRenderer.startMs ?? segRenderer.startTimeMs ?? segRenderer.tStartMs ?? segRenderer.startTime ?? 0);
                const runs = segRenderer.snippet?.runs || segRenderer.subtitleText?.runs || segRenderer.bodyText?.runs || [];
                const text = extractTextFromRuns(runs);
                if (!text) return;
                const time = formatTimestamp(startMs / 1000);
                result.lines.push(`${time} ${text}`);
            });

            const footer = renderer.footer?.transcriptFooterRenderer || renderer.transcriptFooterRenderer;
            const subMenuItems = footer?.languageMenu?.sortFilterSubMenuRenderer?.subMenuItems || [];
            subMenuItems.forEach(item => {
                const label = item?.title || '';
                const continuation = item?.continuation?.reloadContinuationData?.continuation;
                if (!label || !continuation) return;
                const decoded = decodeParam(continuation);
                result.languageParams.push({
                    label,
                    params: decoded,
                    selected: Boolean(item.selected),
                });
                if (item.selected && decoded) {
                    result.defaultParam = decoded;
                }
            });
        });

        result.lines = dedupeLines(result.lines);
        return result;
    }

    function collectTranscriptPanels(data) {
        const panels = [];
        if (!data || typeof data !== 'object') return panels;

        const queue = [data];
        const seen = new Set();

        while (queue.length) {
            const current = queue.shift();
            if (!current || typeof current !== 'object') continue;
            if (seen.has(current)) continue;
            seen.add(current);

            if (current.transcriptSearchPanelRenderer && current.transcriptSearchPanelRenderer.body) {
                panels.push(current.transcriptSearchPanelRenderer);
            } else if (current.transcriptRenderer && current.transcriptRenderer.body) {
                panels.push(current.transcriptRenderer);
            } else if (current.body?.transcriptSegmentListRenderer) {
                panels.push(current);
            }

            for (const value of Object.values(current)) {
                if (!value) continue;
                if (Array.isArray(value)) {
                    value.forEach(item => {
                        if (item && typeof item === 'object') queue.push(item);
                    });
                } else if (typeof value === 'object') {
                    queue.push(value);
                }
            }
        }

        return panels;
    }

    function decodeParam(param) {
        if (typeof param !== 'string') return param;
        return param.replace(/\\u0026/g, '&').replace(/\u0026/g, '&');
    }

    function ytcfgGet(key) {
        try {
            if (typeof window.ytcfg?.get === 'function') {
                const value = window.ytcfg.get(key);
                if (value !== undefined) return value;
            }
        } catch (error) {
            logError('ytcfg get error', error);
        }
        const dataStore = window.ytcfg?.data_;
        if (dataStore && Object.prototype.hasOwnProperty.call(dataStore, key)) {
            return dataStore[key];
        }
        return undefined;
    }

    function getInnertubeApiKey() {
        return ytcfgGet('INNERTUBE_API_KEY');
    }

    function getInnertubeContext() {
        const context = ytcfgGet('INNERTUBE_CONTEXT');
        if (!context) return null;
        return cloneData(context);
    }

    function getInnertubeHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };
        const clientName = ytcfgGet('INNERTUBE_CONTEXT_CLIENT_NAME');
        const clientVersion = ytcfgGet('INNERTUBE_CONTEXT_CLIENT_VERSION');
        if (clientName) headers['X-Youtube-Client-Name'] = String(clientName);
        if (clientVersion) headers['X-Youtube-Client-Version'] = String(clientVersion);
        return headers;
    }

    function cloneData(value) {
        try {
            return value ? JSON.parse(JSON.stringify(value)) : value;
        } catch {
            return value;
        }
    }

    function findTranscriptParamInObject(obj, seen = new Set()) {
        if (!obj || typeof obj !== 'object') return null;
        if (seen.has(obj)) return null;
        seen.add(obj);

        if (obj.getTranscriptEndpoint?.params) {
            return decodeParam(obj.getTranscriptEndpoint.params);
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = findTranscriptParamInObject(item, seen);
                if (found) return found;
            }
        } else {
            for (const key of Object.keys(obj)) {
                const value = obj[key];
                if (typeof value !== 'object' || value === null) continue;
                const found = findTranscriptParamInObject(value, seen);
                if (found) return found;
            }
        }

        return null;
    }

    function extractTranscriptParamFromDocument() {
        try {
            const html = document.documentElement?.innerHTML;
            if (!html) return null;
            return extractParamFromHtml(html);
        } catch {
            return null;
        }
    }

    async function fetchTranscriptParamFromWatch(videoId) {
        try {
            const url = `${location.origin}/watch?v=${encodeURIComponent(videoId)}&bp=0`;
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) return null;
            const html = await response.text();
            return extractParamFromHtml(html);
        } catch (error) {
            logError('fetch watch error', error);
            return null;
        }
    }

    function extractParamFromHtml(html) {
        if (!html) return null;
        const marker = '"getTranscriptEndpoint":{"params":"';
        const idx = html.indexOf(marker);
        if (idx === -1) return null;
        const start = idx + marker.length;
        const end = html.indexOf('"', start);
        if (end === -1) return null;
        const raw = html.slice(start, end);
        return decodeParam(raw);
    }

    async function requestInnertubeTranscript(apiKey, context, headers, params) {
        if (!apiKey || !context || !params) return null;
        const response = await fetch(`${location.origin}/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ context: cloneData(context), params }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        return parseTranscriptResponse(data);
    }

    function cacheTranscript(videoId, lines) {
        if (!videoId || !Array.isArray(lines) || !lines.length) return;
        state.transcriptsByVideo.set(videoId, lines);
        if (state.transcriptsByVideo.size > 6) {
            const oldestKey = state.transcriptsByVideo.keys().next().value;
            if (oldestKey && oldestKey !== videoId) {
                state.transcriptsByVideo.delete(oldestKey);
            }
        }
    }

    function storeTranscriptParam(videoId, param) {
        if (!videoId || !param) return;
        state.transcriptParamsByVideo.set(videoId, param);
        if (state.transcriptParamsByVideo.size > 10) {
            const oldestKey = state.transcriptParamsByVideo.keys().next().value;
            if (oldestKey && oldestKey !== videoId) {
                state.transcriptParamsByVideo.delete(oldestKey);
            }
        }
    }

    function extractTextFromRuns(runs) {
        if (!Array.isArray(runs) || !runs.length) return '';
        return runs.map(run => run?.text || '').join('').replace(/\s+/g, ' ').trim();
    }

    function dedupeLines(lines) {
        if (!Array.isArray(lines) || lines.length === 0) return [];
        const seen = new Set();
        const result = [];
        for (const line of lines) {
            if (!line) continue;
            if (seen.has(line)) continue;
            seen.add(line);
            result.push(line);
        }
        return result;
    }

    function waitForElement(getter, timeout = 3000, interval = 100) {
        const result = getter();
        if (result) return Promise.resolve(result);
        return new Promise(resolve => {
            const deadline = Date.now() + timeout;
            (function poll() {
                const value = getter();
                if (value) {
                    resolve(value);
                    return;
                }
                if (Date.now() >= deadline) {
                    resolve(null);
                    return;
                }
                setTimeout(poll, interval);
            })();
        });
    }

    function writeToClipboard(text) {
        const gmClipboard = typeof GM_setClipboard === 'function'
            ? GM_setClipboard
            : (typeof GM !== 'undefined' && typeof GM.setClipboard === 'function' ? GM.setClipboard : null);

        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).catch(err => {
                if (gmClipboard) {
                    gmClipboard(text);
                    return;
                }
                throw err;
            });
        }
        if (gmClipboard) {
            gmClipboard(text);
            return Promise.resolve();
        }
        return Promise.reject(new Error('Clipboard API unavailable.'));
    }

    function getVideoInfo() {
        const titleNode = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
        const channelNode = document.querySelector('ytd-video-owner-renderer #text a');
        const dateNode = document.querySelector('#info-strings yt-formatted-string');
        return {
            title: titleNode?.textContent?.trim() || 'N/A',
            channel: channelNode?.textContent?.trim() || 'N/A',
            published: dateNode?.textContent?.trim() || '',
            url: window.location.href,
        };
    }

    function formatTimestamp(seconds) {
        const total = Math.max(0, Math.floor(seconds));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const parts = [
            h > 0 ? String(h).padStart(2, '0') : null,
            String(h > 0 ? m : Math.max(m, 0)).padStart(2, '0'),
            String(s).padStart(2, '0'),
        ].filter(Boolean);
        return parts.join(':');
    }

    function sanitize(str) {
        return str
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase() || 'youtube-transcript';
    }

    function normalizeString(str = '') {
        return str
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function showToast(message, isError = false) {
        const existing = document.querySelector(`.${PREFIX}-toast`);
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `${PREFIX}-toast${isError ? ' --error' : ''}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('--show'));
        setTimeout(() => {
            toast.classList.remove('--show');
            setTimeout(() => toast.remove(), 200);
        }, isError ? 4000 : 2500);
    }

    function log(message) {
        console.log(`[${PREFIX}] ${message}`);
    }

    function logError(message, error) {
        if (
            message.startsWith('timedtext') ||
            message === 'fetch wrapper error' ||
            message === 'fetch watch error' ||
            message === 'ytcfg get error'
        ) {
            console.debug(`[${PREFIX}] ${message}`, error);
            return;
        }
        console.error(`[${PREFIX}] ${message}`, error);
    }
})();

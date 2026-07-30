const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Extract `window.playerConfig = {...}` from the player HTML page by
 * balancing braces. The /config endpoint is unreliable for text_tracks
 * (sometimes context-gated), but the embed page always ships the full
 * config inline — exactly what a real browser loads.
 */
function extractConfigFromHtml(html) {
  const marker = 'window.playerConfig';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  // find the first '{' after the marker
  const open = html.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0, inStr = false, esc = false, strCh = '';
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === strCh) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; }
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) {
      const slice = html.slice(open, i + 1);
      try { return JSON.parse(slice); } catch { return null; }
    } }
  }
  return null;
}

/**
 * Find a caption VTT URL embedded in the player HTML.
 * Vimeo JSON-escapes the `&` as \u0026 (or occasionally &amp; / &), so we
 * match all three and normalize back to a real query string.
 */
function findCaptionUrl(html) {
  if (!html) return null;
  const m = html.match(/https:\\?\/\\?\/captions\.vimeo\.com\\?\/captions\\?\/(\d+)\.vtt\?expires=\d+(?:\\u0026|&amp;|&)sig=[a-f0-9]+/)
          || html.match(/https:\/\/captions\.vimeo\.com\/captions\/(\d+)\.vtt\?expires=\d+(?:\\u0026|&amp;|&)sig=[a-f0-9]+/);
  if (!m) return null;
  return m[0]
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/');
}

/**
 * 1) /config endpoint  (fast when it includes text_tracks)
 * 2) player HTML page   (always has the inline window.playerConfig)
 */
async function getVimeoConfig(videoId) {
  const baseHeaders = {
    'User-Agent': UA,
    'Referer': `https://player.vimeo.com/video/${videoId}`,
    'Origin': 'https://player.vimeo.com'
  };
  try {
    const { data } = await axios.get(`https://player.vimeo.com/video/${videoId}/config`, {
      headers: baseHeaders, timeout: 15000
    });
    if (data?.video?.text_tracks?.length) return data;
    // fall through to HTML if /config lacked captions
  } catch { /* try HTML below */ }

  const { data: html } = await axios.get(`https://player.vimeo.com/video/${videoId}`, {
    headers: { 'User-Agent': UA }, timeout: 15000
  });
  const cfg = extractConfigFromHtml(html);
  if (cfg && (cfg.video || cfg.request)) { cfg.__html = html; return cfg; }
  throw new Error('Could not resolve Vimeo config from /config or player page');
}

/**
 * Quick check: does this module page embed any Vimeo content?
 * Used to avoid an unnecessary config fetch when there's no video.
 */
function hasVimeoEmbed(modData = {}, html = '') {
  const combined = [
    ...(modData.iframes || []).map((f) => f && f.src),
    modData.contentHtml,
    html
  ].filter(Boolean).join('\n');
  return /vimeo\.com|player\.vimeo\.com/i.test(combined);
}

/**
 * Pull every Vimeo video id found in a module page.
 * Checks iframe srcs, any inline HTML content, and the raw page HTML.
 */
function extractVimeoIds({ iframes = [], contentHtml = '', html = '' } = {}) {
  const ids = new Set();
  const sources = [];
  if (Array.isArray(iframes)) iframes.forEach((f) => f && f.src && sources.push(f.src));
  if (contentHtml) sources.push(contentHtml);
  if (html) sources.push(html);
  const full = sources.join('\n');

  const rePlayer = /player\.vimeo\.com\/video\/(\d+)/g;
  const reShort = /vimeo\.com\/(?:video\/)?(\d+)/g;
  let m;
  while ((m = rePlayer.exec(full))) ids.add(m[1]);
  while ((m = reShort.exec(full))) ids.add(m[1]);
  return [...ids];
}

/**
 * Parse a WebVTT file into plain cues + a single concatenated transcript.
 */
function parseVtt(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const cues = [];
  let i = 0;

  // skip the WEBVTT header / STYLE / REGION blocks
  while (
    i < lines.length &&
    lines[i].trim() !== '' &&
    !lines[i].includes('-->') &&
    !/^\d{1,2}:\d{2}/.test(lines[i])
  ) {
    i++;
  }

  while (i < lines.length) {
    // skip blanks and NOTE comments
    while (
      i < lines.length &&
      (lines[i].trim() === '' || lines[i].trim().toUpperCase().startsWith('NOTE'))
    ) {
      i++;
    }
    if (i >= lines.length) break;

    let tsLine = lines[i];
    // an optional cue-identifier line precedes the timestamp
    if (!tsLine.includes('-->')) {
      i++;
      tsLine = lines[i];
    }
    if (!tsLine || !tsLine.includes('-->')) {
      i++;
      continue;
    }
    const m = tsLine.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
    const start = m ? m[1] : null;
    i++;

    const texts = [];
    while (i < lines.length && lines[i].trim() !== '') {
      const ln = lines[i];
      if (ln.trim().toUpperCase().startsWith('NOTE')) break;
      texts.push(ln.replace(/<[^>]+>/g, '').trim());
      i++;
    }
    if (texts.length) cues.push({ t: start, text: texts.join(' ').trim() });
  }

  const fullText = cues.map((c) => c.text).join(' ');
  return { cues, full: fullText };
}

/**
 * Lightweight metadata: title, duration, thumbnail, stream manifests, captions links.
 * Does NOT fetch the transcript (use getVimeoTranscript for that).
 */
async function getVimeoMeta(videoId) {
  const config = await getVimeoConfig(videoId);
  const v = config.video || {};
  const files = config.request?.files || {};

  const hlsCdn = files.hls?.cdns?.[files.hls.default_cdn];
  const dashCdn = files.dash?.cdns?.[files.dash.default_cdn];

  const hls = hlsCdn?.url || files.hls?.captions || null;
  const dash = dashCdn?.url || dashCdn?.avc_url || null;

  let captions = (v.text_tracks || []).map((t) => ({
    id: t.id,
    lang: t.lang,
    label: t.label,
    url: t.url,
    isDefault: !!t.default,
    aiGenerated: t.provenance === 'ai_generated'
  }));

  // Fallback: some enterprise videos omit text_tracks from the config.
  // The caption VTT link may still be present in the player HTML.
  if (!captions.length && config.__html) {
    const url = findCaptionUrl(config.__html);
    if (url) {
      captions.push({
        id: Number(url.match(/captions\/(\d+)\.vtt/)[1]),
        lang: 'en-x-autogen',
        label: 'English (auto-generated)',
        url,
        isDefault: true,
        aiGenerated: true
      });
    }
  }

  return {
    id: videoId,
    title: v.title || null,
    duration: v.duration || null,
    width: v.width || null,
    height: v.height || null,
    thumbnail: v.thumbnail_url || null,
    owner: v.owner?.name || null,
    embed: `https://player.vimeo.com/video/${videoId}`,
    hls,
    dash,
    captions,
    hasCaptions: captions.length > 0
  };
}

/**
 * Full transcript: resolves the caption track and parses the VTT.
 */
async function getVimeoTranscript(videoId) {
  const config = await getVimeoConfig(videoId);
  let tracks = config.video?.text_tracks || [];

  // Fallback: scan player HTML for the caption VTT link when text_tracks is empty.
  if (!tracks.length && config.__html) {
    const url = findCaptionUrl(config.__html);
    if (url) {
      tracks = [{
        id: Number(url.match(/captions\/(\d+)\.vtt/)[1]),
        lang: 'en-x-autogen',
        label: 'English (auto-generated)',
        url,
        default: true,
        provenance: 'ai_generated'
      }];
    }
  }

  if (!tracks.length) {
    return { found: false, language: null, label: null, cues: [], full: '' };
  }
  const track = tracks.find((t) => t.default) || tracks[0];

  const { data: vtt } = await axios.get(track.url, {
    headers: { 'User-Agent': UA, 'Referer': `https://player.vimeo.com/video/${videoId}`, 'Origin': 'https://player.vimeo.com' },
    timeout: 15000
  });

  const parsed = parseVtt(typeof vtt === 'string' ? vtt : vtt.data || '');
  return {
    found: true,
    language: track.lang,
    label: track.label,
    aiGenerated: track.provenance === 'ai_generated',
    cueCount: parsed.cues.length,
    cues: parsed.cues,
    full: parsed.full
  };
}

module.exports = {
  extractVimeoIds,
  hasVimeoEmbed,
  findCaptionUrl,
  getVimeoConfig,
  parseVtt,
  getVimeoMeta,
  getVimeoTranscript
};

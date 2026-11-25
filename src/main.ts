import '@fontsource-variable/inter';
import '@fontsource-variable/playfair-display';
import './style.css';
import { WebGLRenderer } from 'three';
import { demoDuration, demoLines, DemoTone } from './demo';
import { allFixtureIds, fixtureSpecs, getFixtureSpec } from './fixture';
import type { FixtureSpec } from './fixture';
import { defaults, emit, isTauri, listen, loadSettings, native, onSettingsChange, PlaybackClock, saveSettings, trackKey } from './model';
import type { Artwork, BackgroundMode, CueLine, MediaSession, MediaSnapshot, Settings } from './model';
import { readLocal, writeLocal } from './storage';
import { WorkspaceUi } from './ui';
import type { MonitorInfo } from './ui';
import { MotionScene, styles } from './motion';
import type { LyricLine } from './motion';
import { lookupLyrics, parseLyrics } from './lyrics';
import type { LyricsResult } from './lyrics';
import { BackgroundScene, defaultPalette, demoStylePalette, manualPalette, PaletteTransition, paletteFromArtwork } from './color';
import type { DynamicPalette } from './color';
import { deriveMaterials, readableInk } from './color/materials';
import { normalizePoints, parseBlend, parseRotation } from './color/gradientState';
import { projectTransport } from './transport';

const root = document.getElementById('app')!;
const searchParams = new URLSearchParams(location.search);
const fixtureParam = searchParams.get('fixture');
const fixtureMode = fixtureParam !== null;
const overlay = searchParams.has('overlay') || (isTauri() && location.hash === '#overlay');
document.documentElement.classList.toggle('overlay', overlay);
if (fixtureMode && searchParams.get('stageOnly') === '1') {
  document.documentElement.classList.add('fixture-stage-only');
}
let settings = loadSettings();
const requestedStyle = fixtureMode ? searchParams.get('style') : null;
let preview = requestedStyle && styles.some(s => s.id === requestedStyle)
  ? requestedStyle
  : styles.some(s => s.id === settings.activeStyle) ? settings.activeStyle : styles[0].id;
if (fixtureMode) {
  const modeParam = searchParams.get('mode') as BackgroundMode | null;
  if (modeParam) settings = { ...settings, mode: modeParam };
}
let sessions: MediaSession[] = [];
let session: MediaSession | undefined;
let error = '';
let monitors: MonitorInfo[] = [];
let generation = 0;
let artworkRequest = 0;
let key = '';
let offset = 0;
let loading = false;
let lyrics: LyricsResult | undefined;
let localLyrics: LyricsResult | undefined;
let standaloneImport: LyricsResult | undefined;
let abort: AbortController | undefined;
let artwork: Artwork | null = null;
let automaticPalette = defaultPalette;
let locked: DynamicPalette | undefined;
let selectedPalette = defaultPalette;
let palette = defaultPalette;
const transition = new PaletteTransition(defaultPalette);
const clock = new PlaybackClock();
let demo = true;
let paused = fixtureMode;
let demoAnchor = performance.now();
const initialFixtureTime = fixtureMode ? Number(searchParams.get('time')) : NaN;
let demoPosition = Number.isFinite(initialFixtureTime) ? Math.max(0, initialFixtureTime) : 0;
let fixtureSpec: FixtureSpec = getFixtureSpec(fixtureParam);
let fixtureCustomLines: readonly LyricLine[] | undefined;
let fixtureDurationMs: number | undefined;
let fixtureReducedOverride: boolean | undefined = fixtureMode && searchParams.get('reduced') === '1' ? true : undefined;
let fixtureOverlayOverride: boolean | undefined;
let fixtureBgTimeMs: number | undefined;
let fixturePalettePinned = false;
let stage!: HTMLElement;
let ui: WorkspaceUi | undefined;
let renderer: WebGLRenderer | undefined;
let motion: MotionScene | undefined;
let background: BackgroundScene | undefined;
let frameRequest = 0;
let watchdog = 0;
let mediaLoading = false;
let refreshQueued = false;
let nextFrame = 0;
let lastTheme = 0;
let lastPaletteForDom: DynamicPalette | undefined;
let lastMaterialControls = '';
let width = 0, height = 0;
let galleryDirty = true;
let galleryAt = -Infinity;
let galleryIndex = 0;
let galleryWork = 0;
let currentFont = '';
let showing = !overlay;
const ownedFonts = new Set<string>();
const tone = new DemoTone();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function activeDemoLines(): readonly CueLine[] {
  return fixtureMode ? (fixtureCustomLines ?? fixtureSpec.lines) as readonly CueLine[] : demoLines;
}
function activeDemoDuration(): number {
  return fixtureMode ? (fixtureDurationMs ?? fixtureSpec.durationMs) : demoDuration;
}
function uiData() {
  return {
    settings, style: preview, demo, rehearsal: !demo && !session && !!standaloneImport, paused, sound: tone.enabled, sessions, media: session,
    quality: lyrics?.quality ?? standaloneImport?.quality, message: lyrics?.message,
    provider: lyrics?.source, loading, error, offset,
    palette: [palette.background, palette.primary, palette.secondary, palette.accent, palette.surface],
    monitors,
  };
}
function updateUi() {
  ui?.update(uiData());
  const doc = lyrics ?? (!session ? standaloneImport : undefined);
  const message = demo ? '' : error && !session ? 'Windows media sessions are unavailable.' :
    !session && !standaloneImport ? 'Start music in a compatible player.' : loading ? 'Looking up lyrics…' :
    lyrics?.quality === 'instrumental' ? 'Instrumental track' :
    lyrics?.quality === 'unavailable' ? lyrics.message || 'Lyrics unavailable for this track.' :
    !doc ? (!settings.autoLookup ? 'Online lookup is off. Import lyrics from player diagnostics.' :
      !session?.artist ? 'Waiting for title and artist from the player.' : 'Lyrics unavailable for this track.') :
    session && !clock.valid ? 'This player has not shared playback position.' : '';
  const plain = !demo && doc && (doc.quality === 'plain' || session && !clock.valid)
    ? doc.lines.map(x => x.text).join('\n') : '';
  ui?.displayEmpty(message, plain);
  if (!demo && (session || !standaloneImport)) ui?.tick(projectTransport(clock.valid ? clock.at() : undefined, session?.durationMs), true);
}
function notify(message: string) { ui?.notice(message); }
function rehearsalDuration() {
  return standaloneImport?.lines.reduce((end, cue) => Math.max(end, cue.endMs), 1000) ?? demoDuration;
}
function demoAt(now = performance.now(), duration = demo ? activeDemoDuration() : !session ? rehearsalDuration() : demoDuration) {
  if (fixtureMode && demo && paused) return clamp(demoPosition, 0, Math.max(0, duration));
  return (demoPosition + (paused ? 0 : Math.max(0, now - demoAnchor))) % duration;
}
function seek(ms: number) {
  const duration = !demo && !session && standaloneImport ? rehearsalDuration() : activeDemoDuration();
  demoPosition = clamp(ms, 0, Math.max(0, duration - 1)); demoAnchor = performance.now(); tone.silence(); invalidate();
}
function previewStyle(id: string) {
  if (styles.some(x => x.id === id) && preview !== id) {
    preview = id; galleryDirty = true;
    if (demo && settings.matchArt && !settings.paletteLocked && !overlay && !fixturePalettePinned) pickPalette();
    if (!reduced.matches && !overlay && !fixtureMode) stage.animate([{opacity: .7, transform: 'scale(1.012)'}, {opacity: 1, transform: 'none'}], {duration: 240, easing: 'cubic-bezier(.22,.65,.23,1)'});
  }
}
function markGallery() { galleryDirty = true; galleryAt = -Infinity; requestGallery(); invalidate(); }
function pickPalette(target = settings.paletteLocked && locked ? locked :
  settings.matchArt && settings.mode !== 'manual'
    ? (!overlay && demo && !fixturePalettePinned ? demoStylePalette(preview) : automaticPalette)
    : manualPalette(settings.primary, settings.secondary, settings.accent)) {
  selectedPalette = target;
  const duration = fixtureMode || reduced.matches ? 0 : settings.transition;
  transition.setTarget(target, performance.now(), duration);
  if (duration === 0) palette = target;
  galleryDirty = true; invalidate();
}
function themeToDom(p: DynamicPalette) {
  if (overlay) return;
  const css = document.documentElement.style;
  const materials = deriveMaterials(p, settings.tint / 100, settings.glass / 100);
  css.setProperty('--env-fg', p.foreground);
  css.setProperty('--env-muted', materials.muted);
  css.setProperty('--env-accent', p.accent);
  css.setProperty('--env-on-accent', materials.accentInk);
  css.setProperty('--env-glass', materials.toolbar);
  css.setProperty('--env-popover', materials.popover);
  css.setProperty('--env-gallery', materials.gallery);
  css.setProperty('--env-edge', materials.border);
  css.setProperty('--env-specular', materials.specular);
  css.setProperty('--env-shadow', materials.shadow);
  css.setProperty('--glass-opacity', `${materials.opacity * 100}%`);
  ui?.updateSwatches();
}
function savedPalette(id: string): DynamicPalette | undefined {
  try { return JSON.parse(localStorage.getItem(`lyricmotion.palette.${id}`) ?? 'null') ?? undefined; }
  catch { return undefined; }
}
function savePalette(id: string, value: DynamicPalette | undefined) {
  try { value ? localStorage.setItem(`lyricmotion.palette.${id}`, JSON.stringify(value)) : localStorage.removeItem(`lyricmotion.palette.${id}`); }
  catch { /* optional local store */ }
}
locked = savedPalette('locked');
async function ensureFont(family: string) {
  if (family === currentFont) return;
  currentFont = family;
  try {
    if (family.startsWith('LyricMotion Imported ') && !ownedFonts.has(family)) {
      const data = await readLocal<ArrayBuffer>(`font:${family}`);
      if (!data) return;
      const face = await new FontFace(family, data).load();
      document.fonts.add(face); ownedFonts.add(family);
    } else { await document.fonts.load(`${settings.weight} 28px "${family.replaceAll('"','')}"`); }
  } catch { /* fallback to system font */ }
  (motion as (MotionScene & {invalidateText?: () => void}) | undefined)?.invalidateText?.();
  markGallery();
}
let overlayUpdate = 0;
interface NativeOverlayState { visible: boolean; clickThrough: boolean; monitors: MonitorInfo[]; error?: string }
const overlayKeys = new Set(['overlay','clickThrough','monitor','placement','overlaySize','hideFullscreen','hidePaused','fullscreen','keepAwake','desktopOnly']);
function onOverlayState(state: NativeOverlayState) {
  monitors = state.monitors;
  if (overlay) {
    showing = state.visible;
    settings = {...settings, overlay:state.visible, clickThrough:state.clickThrough};
    if (showing) { void refresh(); invalidate(); }
    return;
  }
  if (!overlaySyncInFlight && (settings.overlay !== state.visible || settings.clickThrough !== state.clickThrough)) {
    settings = {...settings, overlay:state.visible, clickThrough:state.clickThrough};
    saveAndUpdate();
    ui?.refreshPanel();
  } else updateUi();
}
let overlaySyncInFlight = false;
function syncOverlay(showChanged = false) {
  if (!isTauri() || overlay) return;
  clearTimeout(overlayUpdate);
  overlayUpdate = window.setTimeout(async () => {
    try {
      overlaySyncInFlight = true;
      const state = await native<NativeOverlayState>('overlay_state');
      if (!settings.overlay) { if (showChanged) onOverlayState(await native('overlay_hide')); return; }
      const display = state.monitors.find(m => m.id === settings.monitor) ?? state.monitors.find(m => (m as MonitorInfo & {primary?:boolean}).primary);
      const available = display as (MonitorInfo & {width?:number;height?:number;scaleFactor?:number}) | undefined;
      const factor = settings.overlaySize / 100;
      const scale = available?.scaleFactor || 1;
      await native('overlay_configure', {
        monitor: settings.monitor || 'primary',
        position: settings.placement === 'left' || settings.placement === 'right' ?
          {x:settings.placement === 'left' ? 0 : 1,y:.5} : settings.placement,
        size: settings.fullscreen ? 'fullscreen' : {
          width:Math.max(120,(available?.width ?? 1600)*factor/scale), height:Math.max(60,(available?.height ?? 900)*factor*.58/scale),
        },
      });
      await native('overlay_click_through',{enabled:settings.clickThrough});
      if (showChanged) onOverlayState(await native('overlay_show'));
    } catch (ex) { notify(String(ex)); }
    finally { overlaySyncInFlight = false; }
  }, showChanged ? 0 : 100);
}
function saveAndUpdate() {
  saveSettings(settings); updateUi(); invalidate();
}
function updateSetting<K extends keyof Settings>(k: K, value: Settings[K]) {
  if (settings[k] === value) return;
  if (k === 'zenPoints') {
    const points = normalizePoints(value);
    if (!points.length) return;
    value = points as Settings[K];
  } else if (k === 'zenBlendMode') value = parseBlend(value) as Settings[K];
  else if (k === 'zenRotation') value = parseRotation(value) as Settings[K];
  settings = { ...settings, [k]: value };
  if (k === 'font' || k === 'weight') { currentFont = ''; void ensureFont(settings.font); markGallery(); }
  if (k === 'mode' || k === 'matchArt' || ['primary','secondary','accent'].includes(k)) {
    if (['primary','secondary','accent'].includes(k)) settings = { ...settings, matchArt:false, paletteLocked:false };
    else if (k === 'matchArt' && settings.matchArt && settings.mode === 'manual') settings.mode = 'atmospheric';
    pickPalette();
  }
  if (k === 'autoLookup' || k === 'estimated') void refreshLyrics();
  if (k === 'sourceId' && isTauri()) void native('media_select',{id:settings.sourceId || null}).then(refresh).catch(ex => notify(String(ex)));
  if (overlayKeys.has(k)) syncOverlay(k === 'overlay');
  saveAndUpdate();
  if (k === 'matchArt' || k === 'mode' || k === 'zenAuto') ui?.refreshPanel();
}
function changeOffset(delta: number, absolute = false) {
  if (!key) { notify('Start a song before adjusting timing.'); return; }
  offset = absolute ? 0 : clamp(offset + delta, -10000, 10000);
  if (settings.rememberOffset) settings = { ...settings, offsets: { ...settings.offsets, [key]: offset } };
  if (isTauri()) void emit('lyricmotion-offset', {key, offset}).catch(console.warn);
  saveAndUpdate();
}
async function action(name: string, value?: string) {
  switch (name) {
    case 'gallery-changed': markGallery(); return;
    case 'preview': if (value) previewStyle(value); break;
    case 'select-tile': if (value) previewStyle(value); settings = {...settings,activeStyle:preview}; saveAndUpdate(); return;
    case 'select': settings = {...settings,activeStyle:preview}; saveAndUpdate(); return;
    case 'pin':
      settings = {...settings,pins:settings.pins.includes(preview) ? settings.pins.filter(id => id !== preview) : [...settings.pins,preview]}; saveAndUpdate(); return;
    case 'previous': case 'next': {
      const i = styles.findIndex(s => s.id === preview);
      previewStyle(styles[(i + (name === 'next' ? 1 : -1) + styles.length) % styles.length].id); break;
    }
    case 'pause': demoPosition = demoAt(); demoAnchor = performance.now(); paused = !paused; tone.silence(); break;
    case 'restart': seek(0); break;
    case 'sound': await tone.toggle().catch(ex => notify(String(ex))); break;
    case 'demo': if (!demo) { demo = true; demoPosition = 0; demoAnchor = performance.now(); pickPalette(); } break;
    case 'live': demoPosition = demoAt(); demo = false; tone.silence(); pickPalette(); break;
    case 'refresh': if (!isTauri()) notify('Live media detection is available in the Windows build.'); else { await native('media_refresh'); await refresh(); } return;
    case 'retry-lyrics': await refreshLyrics(true); return;
    case 'reset-size': ui?.resetSize(); return;
    case 'reset-offset': changeOffset(0,true); return;
    case 'offset': changeOffset(Number(value)); return;
    case 'lock-palette':
      if (!settings.paletteLocked) { locked = { ...palette }; savePalette('locked', locked); }
      else { locked = undefined; savePalette('locked', undefined); }
      settings = {...settings,paletteLocked:!settings.paletteLocked}; pickPalette(); saveAndUpdate(); ui?.refreshPanel(); return;
    case 'save-palette':
      savePalette('preset', palette); notify('Palette preset saved locally.');
      if (!ui?.host.querySelector('[data-action="load-palette"]')) ui?.refreshPanel();
      return;
    case 'load-palette': {
      const preset = savedPalette('preset');
      if (!preset) { notify('Save a palette first.'); return; }
      locked = preset; savePalette('locked', preset);
      settings = {...settings,paletteLocked:true}; pickPalette(); saveAndUpdate(); ui?.refreshPanel(); return;
    }
    case 'reset-palette':
      locked = undefined; savePalette('locked', undefined);
      settings = {...settings,matchArt:true,paletteLocked:false,mode:'atmospheric',primary:defaults.primary,secondary:defaults.secondary,accent:defaults.accent,
        activeColor:'',inactiveColor:'',textColor:'',saturation:defaults.saturation,brightness:defaults.brightness,darkness:defaults.darkness,
        glass:defaults.glass,tint:defaults.tint,backgroundMotion:defaults.backgroundMotion,grain:defaults.grain,blur:defaults.blur,
         transition:defaults.transition,contrast:defaults.contrast,backdrop:defaults.backdrop, vignette:defaults.vignette};
      pickPalette(); saveAndUpdate(); ui?.refreshPanel(); return;
    case 'system-fonts':
      try { const families = await native<string[]>('font_families'); ui?.setFonts(families); notify(`${families.length} installed font families found.`); }
      catch { notify('System font listing is not available; choose a curated family or import a font.'); } return;
    case 'copy-diagnostics': {
      const result = { sessions: sessions.length, source: session?.source, metadata: !!session?.title,
        artist: !!session?.artist, position: !!session?.timelineValid, artwork: !!artwork, lyrics: lyrics?.quality, error: !!error };
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2)).then(() => notify('Redacted diagnostics copied.')).catch(() => notify('Could not write to the clipboard.'));
      return;
    }
  }
  updateUi(); invalidate();
}
async function importFile(file: File, target: 'font'|'lyrics') {
  try {
    if (target === 'font') {
      if (file.size > 16_000_000 || !/\.(ttf|otf)$/i.test(file.name)) throw new Error('Choose a .ttf or .otf file under 16 MB.');
      const buffer = await file.arrayBuffer();
      const magic = new DataView(buffer).getUint32(0);
      if (![0x00010000,0x4f54544f,0x74727565].includes(magic)) throw new Error('This is not a supported TTF or OTF file.');
      const family = `LyricMotion Imported ${file.name.slice(0,-4).replace(/[^\p{L}\p{N} -]/gu,' ').slice(0,70)}`;
      const face = await new FontFace(family, buffer).load();
      document.fonts.add(face); ownedFonts.add(family);
      await writeLocal(`font:${family}`,buffer);
      updateSetting('font',family); ui?.refreshPanel(); notify('Font imported locally.');
    } else {
      if (file.size > 1_500_000) throw new Error('Lyrics files must be under 1.5 MB.');
      const format = /\.lrc$/i.test(file.name) ? 'lrc' : /\.(ttml|xml)$/i.test(file.name) ? 'ttml' : /\.ya?ml$/i.test(file.name) ? 'lyricsfile' : 'plain';
      const importKey = key, importGeneration = generation;
      const result = parseLyrics(await file.text(), format);
      if (!result.lines.length) throw new Error('The file did not contain usable lyrics.');
      if (importKey) {
        await writeLocal(`lyrics:${importKey}`, result);
        if (importGeneration !== generation) { notify('Lyrics saved for the previous recording.'); return; }
        localLyrics = result; lyrics = result;
        abort?.abort(); loading = false;
      } else if (importGeneration === generation) { standaloneImport = result; seek(0); }
      else { notify('The session changed while opening the file. Import again for the new recording.'); return; }
      demo = false; pickPalette(); updateUi(); invalidate();
      notify(key ? 'Local lyrics attached to this recording.' : 'Lyrics opened in local rehearsal.');
    }
  } catch (ex) { notify(ex instanceof Error ? ex.message : String(ex)); }
}
async function refreshLyrics(force = false) {
  if (!session?.title || !key) return;
  abort?.abort();
  const controller = new AbortController(); abort = controller;
  const token = generation, current = session, currentKey = key;
  loading = true; updateUi();
  try {
    const stored = await readLocal<LyricsResult>(`lyrics:${currentKey}`).catch(() => undefined);
    if (controller.signal.aborted || token !== generation) return;
    localLyrics = stored;
    if (localLyrics) lyrics = localLyrics;
    else if (!settings.autoLookup) lyrics = undefined;
    else if (!current.artist) lyrics = undefined;
    else {
      const found = await lookupLyrics(current, {signal:controller.signal, estimate:settings.estimated, force});
      if (!controller.signal.aborted && token === generation) lyrics = found;
    }
  } catch (ex) {
    if (!controller.signal.aborted && token === generation) {
      lyrics = {lines:[],quality:'unavailable',message: ex instanceof Error ? ex.message : String(ex)};
    }
  } finally {
    if (!controller.signal.aborted && token === generation) { loading = false; updateUi(); invalidate(); }
  }
}
async function refreshArtwork(id: string, token: number) {
  const request = ++artworkRequest;
  const current = () => token === generation && request === artworkRequest;
  try {
    const next = await native<Artwork | null>('media_artwork', {id});
    if (!current()) return;
    if (!next?.dataUrl) { artwork = null; automaticPalette = defaultPalette; pickPalette(); return; }
    if (artwork?.hash === next.hash) return;
    const nextPalette = await paletteFromArtwork(next.dataUrl,next.hash);
    if (!current()) return;
    artwork = next;
    automaticPalette = nextPalette;
    pickPalette();
  } catch {
    if (current()) { artwork = null; automaticPalette = defaultPalette; pickPalette(); }
  }
}
function receive(snapshot: MediaSnapshot) {
  sessions = snapshot.sessions ?? [];
  const next = sessions.find(x => x.id === settings.sourceId) ?? sessions.find(x => x.id === snapshot.activeId) ??
    sessions.find(x => x.playing && x.timelineValid) ?? sessions.find(x => x.playing) ?? sessions[0];
  const nextKey = trackKey(next);
  const changed = nextKey !== key || next?.id !== session?.id || next?.generation !== session?.generation;
  const artworkChanged = next?.artworkRevision !== session?.artworkRevision;
  const playChanged = next?.playing !== session?.playing || next?.timelineValid !== session?.timelineValid ||
    (!next?.playing && next?.positionMs !== session?.positionMs);
  error = snapshot.error ?? '';
  session = next;
  clock.update(next, changed);
  if (changed) {
    generation++; key = nextKey;
    abort?.abort(); lyrics = undefined; localLyrics = undefined; loading = false;
    offset = settings.rememberOffset ? settings.offsets[key] || 0 : 0;
    if (next?.title) {
      void refreshLyrics();
      void refreshArtwork(next.id, generation);
    } else { artwork = null; automaticPalette = defaultPalette; pickPalette(); }
  } else if (next && artworkChanged) void refreshArtwork(next.id, generation);
  if (changed || playChanged) invalidate();
  updateUi();
}
async function refresh() {
  if (!isTauri()) return;
  if (mediaLoading) { refreshQueued = true; return; }
  mediaLoading = true;
  try { receive(await native<MediaSnapshot>('media_snapshot')); }
  catch (ex) { error = String(ex); updateUi(); }
  finally {
    mediaLoading = false;
    clearTimeout(watchdog);
    if (refreshQueued) { refreshQueued = false; void refresh(); }
    else watchdog = window.setTimeout(refresh, session?.playing ? 1000 : 2200);
  }
}
function motionOptions(p: DynamicPalette, w: number, h: number) {
  return {
    width:w,height:h,foreground:settings.textColor || p.foreground,
    active:settings.activeColor || p.foreground,muted:settings.inactiveColor || p.mutedForeground,
    highlightBackground:p.accent,highlightForeground:readableInk(p.accent),
    font:settings.font,weight:settings.weight,size:settings.size/100,
    intensity:settings.intensity/100,speed:settings.motionSpeed/100,
    reducedMotion:fixtureReducedOverride ?? reduced.matches,
    contrast:settings.contrast/100,motionBlur:settings.motionBlur/100,
    overlay:fixtureOverlayOverride ?? overlay,
    pixelRatio:renderer?.getPixelRatio() ?? Math.min(devicePixelRatio, 1.5),
  };
}
function backdropSettings() {
  const isReduced = fixtureReducedOverride ?? reduced.matches;
  return {
    mode:settings.mode, saturation:settings.saturation/100, brightness:settings.brightness/100,
    darkVeil:settings.darkness/100, motion:isReduced ? 0 : settings.backgroundMotion/100, grain:settings.grain/100,
    blur:settings.blur/100, glass:settings.glass/100, tint:settings.tint/100, artworkDataUrl:artwork?.dataUrl,
    contrast:settings.contrast/100, reducedMotion:isReduced, vignette:settings.vignette/100,
    zenPoints:settings.zenPoints, zenBlendMode:settings.zenBlendMode, zenAuto:settings.zenAuto, zenRotation:settings.zenRotation,
  };
}
function invalidate() {
  if (!frameRequest && showing && !document.hidden && renderer) frameRequest = requestAnimationFrame(draw);
}
function renderFrame(now: number, force = false) {
  if (!renderer || !background || !motion || (!force && document.hidden) || !showing) return;
  const nextPalette = transition.sample(now);
  const fading = nextPalette !== selectedPalette && transition.isActive(now);
  palette = nextPalette;
  const materialControls = `${settings.glass}/${settings.tint}`;
  if (lastMaterialControls !== materialControls || (lastPaletteForDom !== palette && (now - lastTheme > 40 || !fading))) {
    if (ui) ui.data.palette = uiData().palette;
    themeToDom(palette); lastTheme = now; lastPaletteForDom = palette; lastMaterialControls = materialControls;
  }
  const doc = lyrics ?? (!session ? standaloneImport : undefined);
  const timed = doc && !['instrumental','unavailable','plain'].includes(doc.quality);
  const useDemo = !overlay && demo;
  const usable = useDemo || (timed && (!session || clock.valid));
  const effectiveOverlay = fixtureOverlayOverride ?? overlay;
  const onOverlay = effectiveOverlay && (!settings.hidePaused || !!session?.playing) && settings.overlay;
  const rehearsal = !useDemo && !overlay && !session && !!standaloneImport;
  const rehearsalEnd = rehearsal ? rehearsalDuration() : 0;
  const transport = useDemo ? projectTransport(demoAt(now), activeDemoDuration()) :
    rehearsal ? projectTransport(demoAt(now, rehearsalEnd), rehearsalEnd) :
    projectTransport(clock.valid ? clock.at(now) : undefined, session?.durationMs, offset);
  const position = fixtureMode && useDemo && paused ? demoPosition : (transport.cueTime ?? 0);
  const lines: readonly CueLine[] = useDemo ? activeDemoLines() : usable && (!effectiveOverlay || onOverlay) ? doc!.lines : [];
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w < 10 || h < 10) return;
  if (w !== width || h !== height) {
    width = w; height = h; renderer.setSize(w,h,false);
  }
  const s = backdropSettings();
  renderer.setClearColor(effectiveOverlay ? 0x0a0c13 : 0x0b101a, effectiveOverlay ? settings.backdrop/100 : 1);
  renderer.clear();
  if (!effectiveOverlay) {
    const bgTime = fixtureMode ? (fixtureBgTimeMs ?? 1200 + position * 0.5) : now;
    background.update(w, h, bgTime, palette, s, renderer.getPixelRatio());
    renderer.render(background.scene, background.camera);
    renderer.clearDepth();
  }
  if (lines.length) {
    motion.sample(overlay ? settings.activeStyle : preview,lines,Math.max(0,position),motionOptions(palette,w,h));
    renderer.render(motion.scene, motion.camera);
  }
  ui?.tick(transport, !useDemo && !rehearsal);
  if (useDemo) { tone.tick(position,!paused); }
  if (!overlay && !fixtureMode) requestGallery(now);
  if (!fixtureMode && (fading || (!overlay && ((useDemo || rehearsal) ? !paused : !!session?.playing)) ||
    (overlay && onOverlay && lines.length > 0 && session?.playing))) invalidate();
}
function draw(now: number) {
  frameRequest = 0;
  if (!renderer || !background || !motion || document.hidden || !showing) return;
  const interval = 1000 / 60;
  if (!fixtureMode && now + 0.5 < nextFrame) { invalidate(); return; }
  nextFrame = Math.max(now - interval, nextFrame || now) + interval;
  renderFrame(now);
}
let thumbRenderer: WebGLRenderer | undefined, thumbScene: MotionScene | undefined;
function requestGallery(now = performance.now()) {
  if (!ui || document.hidden || !showing || galleryWork || (!galleryDirty && (paused || now - galleryAt < 300))) return;
  galleryWork = window.setTimeout(() => {
    galleryWork = 0;
    if (!ui || document.hidden || !showing) return;
    const visible = Array.from(root.querySelectorAll<HTMLElement>('.tile')).filter(n => {
      const r = n.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && r.right > 0 && r.left < innerWidth;
    });
    if (!visible.length) return;
    try {
      if (!thumbRenderer) {
        thumbRenderer = new WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
        thumbRenderer.setSize(180,88,false); thumbScene = new MotionScene();
      }
      const tile = visible[galleryIndex++ % visible.length];
      const tileId = tile.dataset.style!;
      const tilePalette = demo && settings.matchArt && !settings.paletteLocked ? demoStylePalette(tileId) : palette;
      const c = tile.querySelector('canvas')!, ctx = c.getContext('2d')!;
      const opts = motionOptions(tilePalette,180,88);
      thumbScene!.sample(tileId,demoLines,Math.max(250, demoAt()),opts);
      thumbRenderer.setClearColor(0x20263a, 0); thumbRenderer.render(thumbScene!.scene,thumbScene!.camera);
      ctx.fillStyle = tilePalette.background; ctx.fillRect(0,0,180,88);
      const light = ctx.createRadialGradient(119,10,0,110,40,154);
      light.addColorStop(0,tilePalette.primary); light.addColorStop(1,'#00000000');
      ctx.fillStyle = light; ctx.fillRect(0,0,180,88);
      ctx.drawImage(thumbRenderer.domElement,0,0);
      galleryAt = performance.now();
      if (galleryDirty && galleryIndex % visible.length > 0) requestGallery();
      else galleryDirty = false;
    } catch (ex) { console.warn('Style gallery renderer unavailable',ex); }
  }, galleryDirty ? 20 : 80);
}
if (overlay) {
  stage = document.createElement('div'); stage.className = 'stage'; root.append(stage);
} else {
  ui = new WorkspaceUi(root,styles,uiData(),{ action:(name,value) => { void action(name,value).catch(ex => notify(String(ex))); },
    setting:updateSetting,seek,importFile:(file,target) => void importFile(file,target) });
  stage = ui.stage;
  root.querySelector('.tiles')?.addEventListener('scroll', markGallery, {passive:true});
  window.addEventListener('scroll',markGallery,{passive:true});
}
try {
  const dprParam = fixtureMode ? Number(searchParams.get('dpr')) : NaN;
  const initialDpr = fixtureMode
    ? clamp(Number.isFinite(dprParam) ? dprParam : devicePixelRatio, 1, 2.5)
    : Math.min(devicePixelRatio, 1.5);
  renderer = new WebGLRenderer({alpha:overlay,antialias:true,premultipliedAlpha:true,powerPreference:'low-power',preserveDrawingBuffer:fixtureMode});
  renderer.setPixelRatio(initialDpr); renderer.autoClear = false;
  stage.append(renderer.domElement);
  motion = new MotionScene();
  background = new BackgroundScene(invalidate);
  renderer.domElement.addEventListener('webglcontextlost',event => {event.preventDefault(); ui?.error('Graphics device reset. Waiting to recover.');});
  renderer.domElement.addEventListener('webglcontextrestored', () => { ui?.error(''); invalidate(); });
  new ResizeObserver(() => { invalidate(); markGallery(); }).observe(stage);
} catch (ex) {
  console.error(ex); ui?.error('GPU rendering could not start. An accelerated WebGL 2 device is required.');
}
onSettingsChange(next => {
  const old = settings; settings = next;
  if (overlay) settings = {...next,overlay:showing};
  if (old.font !== next.font || old.weight !== next.weight) void ensureFont(next.font);
  if (old.estimated !== next.estimated || old.autoLookup !== next.autoLookup) void refreshLyrics();
  if (old.sourceId !== next.sourceId) void refresh();
  if (key && next.rememberOffset) offset = next.offsets[key] || 0;
  locked = savedPalette('locked'); pickPalette(); updateUi(); invalidate();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { invalidate(); if (isTauri()) void refresh(); }
  else tone.silence();
});
reduced.addEventListener('change', () => { pickPalette(); invalidate(); });
if (isTauri()) {
  if (!overlay) {
    // Native hide/minimize is not consistently reflected by WebView2's Page
    // Visibility API. Use the host's own window state as an additional guard.
    let visibilityRevision = 0;
    const applyNativeVisibility = (visible: boolean) => {
      showing = visible;
      if (!visible) {
        if (frameRequest) cancelAnimationFrame(frameRequest);
        frameRequest = 0;
        tone.silence();
      } else {
        invalidate();
        markGallery();
      }
    };
    void listen<boolean>('native_visibility', e => {
      visibilityRevision++;
      applyNativeVisibility(e.payload);
    }).then(async () => {
      const revision = visibilityRevision;
      const visible = await native<boolean>('native_window_visible');
      if (revision === visibilityRevision) applyNativeVisibility(visible);
    }).catch(console.warn);
  }
  void listen('media_changed', () => { void refresh(); }).catch(console.warn);
  void listen<NativeOverlayState>('overlay_state', e => onOverlayState(e.payload)).catch(console.warn);
  void listen<{key:string;offset:number}>('lyricmotion-offset', e => {
    if (overlay && e.payload.key === key) { offset = e.payload.offset; invalidate(); }
  }).catch(console.warn);
  void refresh();
  void native<NativeOverlayState>('overlay_state').then(onOverlayState).catch(() => {});
}

if (fixtureMode) {
  interface FixturePatch {
    styleId?: string
    fixtureId?: string
    customLines?: LyricLine[]
    durationMs?: number
    mode?: BackgroundMode
    reducedMotion?: boolean
    stageOnly?: boolean
    overlay?: boolean
    dpr?: number
    size?: number
    intensity?: number
    speed?: number
    contrast?: number
    grain?: number
    darkness?: number
    font?: string
    weight?: number
    bgTimeMs?: number
    palette?: { primary: string; secondary: string; accent: string }
    matchArt?: boolean
  }
  const applyPatch = (patch?: FixturePatch) => {
    if (!patch) return;
    let styleChanged = false;
    if (patch.styleId && styles.some(s => s.id === patch.styleId)) {
      if (preview !== patch.styleId) styleChanged = true;
      preview = patch.styleId;
    }
    if (patch.fixtureId) {
      fixtureSpec = getFixtureSpec(patch.fixtureId);
      fixtureCustomLines = undefined;
      fixtureDurationMs = undefined;
    }
    if (patch.customLines) fixtureCustomLines = patch.customLines;
    if (patch.durationMs !== undefined) fixtureDurationMs = patch.durationMs;
    if (patch.stageOnly !== undefined) document.documentElement.classList.toggle('fixture-stage-only', patch.stageOnly);
    if (patch.reducedMotion !== undefined) fixtureReducedOverride = patch.reducedMotion;
    if (patch.overlay !== undefined) fixtureOverlayOverride = patch.overlay;
    if (patch.bgTimeMs !== undefined) fixtureBgTimeMs = patch.bgTimeMs;
    if (patch.dpr !== undefined && renderer) renderer.setPixelRatio(clamp(patch.dpr, 1, 2.5));
    const nextSettings = { ...settings };
    if (patch.mode !== undefined) nextSettings.mode = patch.mode;
    if (patch.size !== undefined) nextSettings.size = patch.size;
    if (patch.intensity !== undefined) nextSettings.intensity = patch.intensity;
    if (patch.speed !== undefined) nextSettings.motionSpeed = patch.speed;
    if (patch.contrast !== undefined) nextSettings.contrast = patch.contrast;
    if (patch.grain !== undefined) nextSettings.grain = patch.grain;
    if (patch.darkness !== undefined) nextSettings.darkness = patch.darkness;
    if (patch.weight !== undefined) nextSettings.weight = patch.weight;
    if (patch.font !== undefined) { nextSettings.font = patch.font; currentFont = ''; void ensureFont(patch.font); }
    if (patch.matchArt !== undefined) {
      nextSettings.matchArt = patch.matchArt;
      if (!patch.matchArt) fixturePalettePinned = true;
    }
    settings = nextSettings;
    if (patch.palette) {
      fixturePalettePinned = true;
      const target = manualPalette(patch.palette.primary, patch.palette.secondary, patch.palette.accent);
      selectedPalette = target;
      palette = target;
      transition.setTarget(target, 0, 0);
    } else if (styleChanged && !fixturePalettePinned && nextSettings.matchArt && nextSettings.mode !== 'manual' && !nextSettings.paletteLocked) {
      const target = demoStylePalette(preview);
      selectedPalette = target;
      palette = target;
      transition.setTarget(target, 0, 0);
    }
    updateUi();
  };
  (window as unknown as { __lyricFixture: unknown }).__lyricFixture = {
    specs: () => allFixtureIds.map(id => {
      const s = fixtureSpecs[id];
      return { id: s.id, label: s.label, durationMs: s.durationMs, sampleTimesMs: s.sampleTimesMs, lineCount: s.lines.length };
    }),
    waitFonts: () => document.fonts.ready,
    renderAt: (timeMs: number, patch?: FixturePatch) => {
      demo = true;
      paused = true;
      demoPosition = Math.max(0, timeMs);
      applyPatch(patch);
      renderFrame(performance.now(), true);
      return {
        fixtureId: fixtureCustomLines ? 'custom' : fixtureSpec.id,
        styleId: preview,
        timeMs: demoPosition,
        dpr: renderer?.getPixelRatio() ?? 1,
        viewport: [stage.clientWidth, stage.clientHeight] as const,
        palette,
        inspection: motion?.inspect(),
      };
    },
    inspect: () => motion?.inspect(),
  };
}

void ensureFont(settings.font);
pickPalette();
updateUi();
if (fixtureMode) renderFrame(performance.now(), true);
else invalidate();

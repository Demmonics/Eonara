import type { MediaSession, Settings } from './model';
import { defaults, isTauri } from './model';
import { demoDuration, demoName } from './demo';
import { formatTransportTime, projectTransport } from './transport';
import { decodeGradientPreset } from './color/gradientState';

const paths: Record<string, string> = {
  size: '<path d="M4 19 9 5l5 14M6 14h6m3 5 3-8 3 8m-5-2h4"/>',
  font: '<path d="M4 6h16M12 6v13m-4 0h8M4 6v3m16-3v3"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9 21h6m-3-4v4"/>',
  sparkle: '<path d="M12 2c0 6 4 10 10 10-6 0-10 4-10 10 0-6-4-10-10-10 6 0 10-4 10-10Z"/>',
  spotify: '<circle cx="12" cy="12" r="9"/><path d="M6.5 9.5c4-1 8-.5 11 1.5M7.5 12.8c3-.7 6-.25 8.5 1.4m-7.7 1.3c2.3-.45 4.6-.05 6.45 1"/>',
  music: '<path d="M10 18V6l10-2v12m-10 2c0 3-7 4-7 1s7-4 7-1zm10-2c0 3-7 4-7 1s7-4 7-1z"/>',
  players: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/>',
  refresh: '<path d="M20 7v5h-5m5 0a8 8 0 1 0-2.2 5.5"/>',
  previous: '<path d="m15 5-7 7 7 7"/>', next: '<path d="m9 5 7 7-7 7"/>',
  pin: '<path d="m15 3 6 6-3 1-3 5-1 3-8-8 3-1 5-3 1-3ZM10 14l-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  play: '<path d="m8 5 12 7-12 7Z"/>',
  pause: '<path d="M9 5v14m6-14v14"/>',
  sound: '<path d="M3 9h4l5-4v14l-5-4H3zM16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>',
  mute: '<path d="M3 9h4l5-4v14l-5-4H3zM16 9l5 6m0-6-5 6"/>',
  restart: '<path d="M4 5v6h6m-6 0a8 8 0 1 1 2.5 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
};
const icon = (name: string) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? ''}</svg>`;
const mark = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 16V9m5 10V5m5 15V4m5 12V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 12 19 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;
const ftime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export interface StyleInfo { id: string; name: string; category: string; description: string }
export interface MonitorInfo { id: string; name: string }
export interface UiData {
  settings: Settings; style: string; demo: boolean; rehearsal: boolean; paused: boolean; sound: boolean;
  sessions: MediaSession[]; media?: MediaSession; quality?: string; message?: string;
  loading: boolean; error?: string; offset: number; provider?: string; wordsAvailable?: boolean;
  palette: string[]; monitors: MonitorInfo[];
}
export interface UiActions {
  action(name: string, value?: string): void;
  setting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  seek(value: number): void;
  importFile(file: File, target: 'font' | 'lyrics'): void;
}
const modeOptions = [
  ['atmospheric', 'Atmospheric'], ['liquid-glass', 'Liquid Glass'], ['artwork', 'Blurred album artwork'],
  ['mesh', 'Mesh gradient'], ['zen', 'Zen harmonic gradient'], ['minimal', 'Minimal'], ['manual', 'Manual'],
];
const qualityNames: Record<string, string> = { word: 'Word-level synchronized', line: 'Line-level synchronized', estimated: 'Estimated word timing', plain: 'Unsynchronized lyrics', instrumental: 'Instrumental', unavailable: 'Lyrics unavailable' };
const button = (label: string, action: string, glyph: string, css = 'icon-button') =>
  `<button type="button" class="${css}" data-action="${action}" title="${label}" aria-label="${label}">${icon(glyph)}</button>`;
const panelBtn = (label: string, action: string, glyph: string) =>
  `<button type="button" data-panel-trigger="${action}" aria-expanded="false" aria-controls="panel">${icon(glyph)}${label}</button>`;
const toggle = (label: string, key: keyof Settings, s: Settings, disabled = false) =>
  `<label class="setting-row"><span>${label}</span><input class="switch" type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}></label>`;
const range = (label: string, key: keyof Settings, s: Settings, min: number, max: number, step = 1, units = '%') =>
  `<div class="setting-range"><label class="setting-row" for="setting-${key}"><span>${label}</span><output>${s[key]}${units}</output></label><input id="setting-${key}" type="range" data-setting="${key}" data-unit="${units}" value="${s[key]}" min="${min}" max="${max}" step="${step}"></div>`;
const color = (label: string, key: keyof Settings, s: Settings, fallback = '#eeecf2') =>
  `<label class="setting-row"><span>${label}</span><input type="color" class="color-input" data-setting="${key}" value="${escapeHtml(s[key] || fallback)}"></label>`;
const select = (label: string, key: keyof Settings, s: Settings, options: string[][], disabled = false) =>
  `<div class="setting-row"><label for="setting-${key}">${label}</label><select id="setting-${key}" data-setting="${key}" ${disabled ? 'disabled' : ''}>${options.map(([val, name]) => `<option value="${escapeHtml(val)}" ${s[key] === val ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></div>`;
const fonts = [
  ['Inter Variable', 'Inter · Modern'], ['Segoe UI Variable', 'Segoe UI · System'], ['Arial', 'Arial · Neutral'],
  ['Bahnschrift', 'Bahnschrift · Grotesk'], ['Trebuchet MS', 'Trebuchet · Geometric'], ['Georgia', 'Georgia · Editorial'],
  ['Playfair Display Variable', 'Playfair · High contrast'], ['Consolas', 'Consolas · Monospaced'],
  ['Yu Gothic', 'Yu Gothic · Japanese'], ['Nirmala UI', 'Nirmala UI · Indic'],
];

export class WorkspaceUi {
  data: UiData;
  #panel = '';
  #anchor: HTMLButtonElement | null = null;
  #all = false;
  #category = '';
  #panelContent = '';
  #noticeTimer = 0;
  #lastWheel = 0;
  #fontFamilies: string[] = [];
  #zenSelected = 0;
  #zenDragging = false;
  constructor(readonly host: HTMLElement, readonly styles: readonly StyleInfo[], initial: UiData, readonly handlers: UiActions) {
    this.data = initial;
    host.innerHTML = `<div class="workspace">
      <section class="hero" aria-label="Style preview">
        <div class="stage" aria-hidden="true"></div><div class="stage-lower"></div>
        <div class="top">
          <div class="brand">${mark}<span>LyricMotion</span></div>
          <nav class="toolbar glass" aria-label="Preview settings">${panelBtn('Size','size','size')}${panelBtn('Font','font','font')}${panelBtn('Screen','screen','screen')}${panelBtn('Aesthetics','aesthetics','sparkle')}</nav>
          <nav class="players" aria-label="Media sessions">
            ${this.playerButton('Spotify', 'spotify')}${this.playerButton('Apple Music', 'music')}${this.playerButton('Other players', 'players')}
            ${button('Refresh media sessions','refresh','refresh')}
          </nav>
        </div>
        <div id="panel" class="popover glass" role="region" aria-label="Settings" hidden></div>
        <div class="status-banner" role="status" hidden></div>
        ${button('Previous style','previous','previous','icon-button arrow previous')}${button('Next style','next','next','icon-button arrow next')}
        <p class="live-empty" aria-live="polite" hidden></p><article class="plain-view" aria-label="Unsynchronized lyrics" hidden></article>
        <div class="hero-footer">
          <section class="style-meta" aria-label="Current style"><span class="category"></span><h1 class="title"></h1><p class="description"></p><div class="actions">
            <button type="button" class="pill primary" data-action="select">Select style</button>
            ${button('Pin style','pin','pin','pill')}
          </div></section>
          <section class="transport" aria-label="Preview playback">
            <div class="transport-top"><div class="segmented" aria-label="Preview source">
              <button type="button" data-action="demo">Demo</button><button type="button" data-action="live">Live</button>
            </div><div class="transport-controls">${button('Pause demo','pause','pause','flat')}${button('Restart demo','restart','restart','flat')}${button('Enable demo audio','sound','mute','flat')}</div></div>
            <div class="scrub"><span data-pos>0:00</span><input type="range" aria-label="Demo position" data-scrub min="0" max="${demoDuration}" step="10" value="0"><progress class="live-progress" aria-label="Live playback progress" max="1" value="0" hidden></progress><span data-end>${ftime(demoDuration)}</span></div>
            <p class="track-caption"></p>
          </section>
        </div><nav class="pages" aria-label="Styles"></nav>
      </section>
      <section class="gallery" aria-label="Style gallery">
        <div class="gallery-head"><h2 class="gallery-heading">All styles</h2><div class="gallery-actions">
          <label class="sr-only" for="gallery-filter">Filter styles</label><select id="gallery-filter"><option value="">All categories</option>${[...new Set(styles.map(s => s.category))].map(s => `<option>${escapeHtml(s)}</option>`).join('')}<option value="_pinned">Pinned</option></select>
          <button type="button" class="flat" data-action="expand" aria-expanded="false">${icon('down')} <span>Expand</span></button>
        </div></div><div class="tiles"></div>
      </section>
    </div>`;
    el<HTMLInputElement>(host, '[data-scrub]').addEventListener('input', e => this.handlers.seek((e.target as HTMLInputElement).valueAsNumber));
    el<HTMLSelectElement>(host, '#gallery-filter').addEventListener('change', e => { this.#category = (e.target as HTMLSelectElement).value; this.#buildTiles(); });
    host.addEventListener('click', e => this.#click(e));
    host.addEventListener('input', e => this.#input(e));
    host.addEventListener('change', e => this.#input(e));
    document.addEventListener('pointerdown', e => {
      if (this.#panel && e.target instanceof Element && !e.target.closest('#panel, [data-panel-trigger]')) this.hidePanel(false);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.#panel) { this.hidePanel(); e.preventDefault(); return; }
      if (e.altKey || e.ctrlKey || e.metaKey || (e.target instanceof Element && e.target.closest('input,select,textarea,button,summary,[contenteditable]'))) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.handlers.action(e.key === 'ArrowLeft' ? 'previous' : 'next'); }
    });
    el(host, '.hero').addEventListener('wheel', e => {
      if (this.#panel || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 8) return;
      e.preventDefault();
      if (performance.now() - this.#lastWheel < 310) return;
      this.#lastWheel = performance.now(); this.handlers.action(e.deltaX < 0 ? 'previous' : 'next');
    }, { passive: false });
    window.addEventListener('resize', () => this.#positionPanel());
    this.#buildTiles();
    this.update(initial);
  }
  get stage() { return el(this.host, '.stage'); }
  setFonts(families: string[]) {
    this.#fontFamilies = [...new Set(families)].sort((a,b) => a.localeCompare(b));
    if (this.#panel === 'font') this.#renderPanel(true);
  }
  playerButton(name: string, glyph: string) {
    return `<button type="button" class="icon-button" data-panel-trigger="diagnostics" data-player="${name}" title="${name}" aria-label="${name} diagnostics" aria-expanded="false" aria-controls="panel">${icon(glyph)}<i class="status-dot"></i></button>`;
  }
  #buildTiles() {
    const filtered = this.styles.filter(s => this.#category === '_pinned' ? this.data.settings.pins.includes(s.id) : !this.#category || this.#category === s.category);
    const tiles = el(this.host, '.tiles');
    tiles.innerHTML = filtered.map(s => `<div class="tile" data-style="${escapeHtml(s.id)}"><canvas width="180" height="88" aria-hidden="true"></canvas><span class="pinmark" hidden>${icon('pin')}</span><button type="button" class="tile-label" data-action="preview" data-value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button><button type="button" class="tile-select" data-action="select-tile" data-value="${escapeHtml(s.id)}" title="Select ${escapeHtml(s.name)}" aria-label="Select ${escapeHtml(s.name)}">${icon('check')}</button></div>`).join('');
    if (!filtered.length) tiles.innerHTML = '<p class="track-caption">No pinned styles.</p>';
    el(this.host, '.pages').innerHTML = this.styles.map(s => `<button type="button" data-action="preview" data-value="${escapeHtml(s.id)}" aria-label="Preview ${escapeHtml(s.name)}" title="${escapeHtml(s.name)}"></button>`).join('');
    this.#markTiles();
    this.handlers.action('gallery-changed');
  }
  #markTiles() {
    this.host.querySelectorAll<HTMLElement>('.tile').forEach(tile => {
      tile.dataset.preview = String(tile.dataset.style === this.data.style);
      tile.dataset.selected = String(tile.dataset.style === this.data.settings.activeStyle);
      el(tile, '.pinmark').hidden = !this.data.settings.pins.includes(tile.dataset.style!);
    });
  }
  #click(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!target) return;
    if (target.dataset.panelTrigger) {
      if (target === this.#anchor && this.#panel) { this.hidePanel(); return; }
      this.openPanel(target.dataset.panelTrigger, target); return;
    }
    const action = target.dataset.action;
    if (!action) return;
    if (action === 'close-panel') { this.hidePanel(); return; }
    if (action === 'expand') {
      this.#all = !this.#all;
      el(this.host, '.gallery').classList.toggle('expanded', this.#all);
      target.setAttribute('aria-expanded', String(this.#all)); el(target,'span').textContent = this.#all ? 'Collapse' : 'Expand';
      if (this.#all) el(this.host, '.gallery').scrollIntoView({ block: 'start', behavior: 'smooth' });
      this.handlers.action('gallery-changed'); return;
    }
    if (action === 'import-font' || action === 'import-lyrics') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = action === 'import-font' ? '.ttf,.otf' : '.lrc,.ttml,.xml,.txt,.yaml,.yml';
      input.addEventListener('change', () => { if (input.files?.[0]) this.handlers.importFile(input.files[0], action === 'import-font' ? 'font' : 'lyrics'); }, { once: true });
      input.click(); return;
    }
    if (action === 'system-fonts') {
      const query = (window as Window & {queryLocalFonts?: () => Promise<{family: string}[]>}).queryLocalFonts;
      if (!query) { this.handlers.action(action); return; }
      query.call(window).then(result => {
        this.setFonts(result.map(f => f.family)); this.notice(`${this.#fontFamilies.length} installed font families found.`);
      }).catch(() => this.handlers.action(action));
      return;
    }
    if (action === 'zen-add-point') {
      const points = [...(this.data.settings.zenPoints || defaults.zenPoints)];
      if (points.length < 6) {
        const pal = this.data.palette;
        const color = pal[points.length % pal.length] || '#e07a5f';
        points.push({ id: crypto.randomUUID(), x: 0.5, y: 0.5, color, spread: 1.6, intensity: 0.9 });
        this.#zenSelected = points.length - 1;
        this.handlers.setting('zenPoints', points);
        this.#renderPanel(true);
      }
      return;
    }
    if (action === 'zen-remove-point') {
      const points = [...(this.data.settings.zenPoints || defaults.zenPoints)];
      if (points.length > 1) {
        points.splice(this.#zenSelected, 1);
        this.#zenSelected = Math.max(0, this.#zenSelected - 1);
        this.handlers.setting('zenPoints', points);
        this.#renderPanel(true);
      }
      return;
    }
    if (action === 'zen-harmonize') {
      this.handlers.setting('zenAuto', true);
      return;
    }
    if (action === 'zen-save-preset') {
      const s = this.data.settings;
      const preset = {version:1, points:s.zenPoints, blend:s.zenBlendMode, auto:s.zenAuto, rotation:s.zenRotation};
      try { localStorage.setItem('lyricmotion.zenPreset', JSON.stringify(preset)); this.notice('Gradient preset saved.'); }
      catch { this.notice('Could not save the gradient preset.'); }
      return;
    }
    if (action === 'zen-load-preset') {
      try {
        const preset = decodeGradientPreset(localStorage.getItem('lyricmotion.zenPreset'));
        if (preset) {
          this.handlers.setting('zenPoints', preset.points);
          this.handlers.setting('zenBlendMode', preset.blend);
          this.handlers.setting('zenRotation', preset.rotation);
          this.handlers.setting('zenAuto', preset.auto);
          this.notice('Gradient preset loaded.');
          this.#renderPanel(true);
          return;
        }
      } catch {}
      this.notice('No valid gradient preset found.');
      return;
    }
    if (action === 'zen-reset') {
      this.handlers.setting('zenPoints', defaults.zenPoints);
      this.handlers.setting('zenBlendMode', defaults.zenBlendMode);
      this.handlers.setting('zenRotation', defaults.zenRotation);
      this.handlers.setting('zenAuto', true);
      this.#zenSelected = 0;
      this.notice('Zen gradient restored to defaults.');
      this.#renderPanel(true);
      return;
    }
    if (action === 'pin' && this.#category === '_pinned') queueMicrotask(() => this.#buildTiles());
    this.handlers.action(action, target.dataset.value);
  }
  #input(event: Event) {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.hasAttribute('data-zen-point')) {
      if (event.type === 'change') {
        this.#zenSelected = Number(target.value); this.#renderPanel(true);
        this.host.querySelector<HTMLSelectElement>('[data-zen-point]')?.focus();
      }
      return;
    }
    if (target instanceof HTMLInputElement && (target.hasAttribute('data-zen-color') || target.hasAttribute('data-zen-hex'))) {
      if (event.type !== 'change') return;
      const color = target.value.trim();
      if (!/^#?[0-9a-f]{6}$/i.test(color)) { this.notice('Enter a six-digit hex colour, e.g. #6e83b8.'); return; }
      const points = [...(this.data.settings.zenPoints || defaults.zenPoints)];
      if (points[this.#zenSelected]) {
        points[this.#zenSelected] = { ...points[this.#zenSelected], color: color.startsWith('#') ? color : `#${color}` };
        this.handlers.setting('zenPoints', points);
        this.handlers.setting('zenAuto', false);
        this.#renderPanel(true);
        this.host.querySelector<HTMLInputElement>(target.hasAttribute('data-zen-hex') ? '[data-zen-hex]' : '[data-zen-color]')?.focus();
      }
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.zenSpread) {
      const points = [...(this.data.settings.zenPoints || defaults.zenPoints)];
      if (points[this.#zenSelected]) {
        points[this.#zenSelected] = { ...points[this.#zenSelected], spread: target.valueAsNumber };
        const out = target.previousElementSibling?.querySelector('output');
        if (out) out.textContent = target.valueAsNumber.toFixed(1);
        this.handlers.setting('zenPoints', points);
        const canvas = this.host.querySelector<HTMLCanvasElement>('.zen-canvas');
        if (canvas) this.#drawZenCanvas(canvas);
      }
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.zenIntensity) {
      const points = [...(this.data.settings.zenPoints || defaults.zenPoints)];
      if (points[this.#zenSelected]) {
        points[this.#zenSelected] = { ...points[this.#zenSelected], intensity: target.valueAsNumber };
        const out = target.previousElementSibling?.querySelector('output');
        if (out) out.textContent = `${Math.round(target.valueAsNumber * 100)}%`;
        this.handlers.setting('zenPoints', points);
        const canvas = this.host.querySelector<HTMLCanvasElement>('.zen-canvas');
        if (canvas) this.#drawZenCanvas(canvas);
      }
      return;
    }
    if (target instanceof HTMLInputElement && target.hasAttribute('data-zen-position')) {
      if (event.type === 'change' && Number.isFinite(target.valueAsNumber)) {
        const axis = target.dataset.zenPosition === 'x' ? 'x' : 'y';
        const points = this.data.settings.zenPoints.map((p, i) => i === this.#zenSelected ?
          {...p, [axis]:Math.max(0,Math.min(1,target.valueAsNumber / 100))} : p);
        this.handlers.setting('zenPoints',points);
        target.value = String(Math.round(points[this.#zenSelected][axis] * 100));
        this.#updateZenHeader();
        const canvas = this.host.querySelector<HTMLCanvasElement>('.zen-canvas'); if (canvas) this.#drawZenCanvas(canvas);
      }
      return;
    }
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || !target.dataset.setting) return;
    if ((target.type === 'range' || target.type === 'color') && event.type !== 'input') return;
    if (target.type !== 'range' && target.type !== 'color' && event.type !== 'change') return;
    const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked :
      target instanceof HTMLInputElement && target.type === 'range' ? target.valueAsNumber : target.value;
    if (target.type === 'range') {
      const output = target.previousElementSibling?.querySelector('output');
      if (output) output.textContent = `${value}${target.dataset.unit ?? ''}`;
    }
    this.handlers.setting(target.dataset.setting as keyof Settings, value);
  }
  openPanel(panel: string, anchor: HTMLButtonElement) {
    if (this.#anchor) this.#anchor.setAttribute('aria-expanded','false');
    this.#anchor = anchor; this.#panel = panel; this.#panelContent = '';
    anchor.setAttribute('aria-expanded','true'); el(this.host,'#panel').hidden = false;
    this.#renderPanel(true); this.#positionPanel();
  }
  hidePanel(focus = true) {
    el(this.host,'#panel').hidden = true;
    this.#anchor?.setAttribute('aria-expanded','false');
    if (focus) this.#anchor?.focus();
    this.#panel = ''; this.#anchor = null; this.#panelContent = '';
  }
  #positionPanel() {
    if (!this.#panel || !this.#anchor) return;
    const panel = el(this.host, '#panel'), rect = this.#anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(9, Math.min(innerWidth - panel.offsetWidth - 9, rect.left + rect.width / 2 - panel.offsetWidth / 2))}px`;
    panel.style.top = `${Math.min(innerHeight - 120, Math.max(50, rect.bottom + 8))}px`;
    panel.style.maxHeight = `${Math.max(180, innerHeight - (rect.bottom + 20))}px`;
  }
  #renderPanel(force = false) {
    if (!this.#panel) return;
    const s = this.data.settings;
    const panel = el(this.host, '#panel');
    let title = this.#panel[0].toUpperCase() + this.#panel.slice(1);
    let content = '';
    switch (this.#panel) {
      case 'size':
        content = `${range('Text size','size',s,50,200)}<div class="panel-buttons"><button class="pill" data-action="reset-size">Reset to 100%</button></div>`;
        break;
      case 'font': {
        const candidates = [...fonts, ...this.#fontFamilies.filter(name => !fonts.some(([family]) => family === name)).map(name => [name,name])];
        if (!candidates.some(([family]) => family === s.font)) candidates.push([s.font, s.font]);
        content = `${select('Typeface','font',s,candidates)}${range('Weight','weight',s,200,900,50,'')}
          <div class="panel-buttons"><button class="pill" data-action="system-fonts">Installed fonts</button><button class="pill" data-action="import-font">Import TTF / OTF</button></div>`;
        break;
      }
      case 'screen': {
        const desktop = isTauri();
        content = `${!desktop ? '<p>Desktop windows are available in the Windows build.</p>' : ''}
          ${toggle('Show desktop lyrics','overlay',s,!desktop)}${select('Display','monitor',s,[['','Primary display'], ...this.data.monitors.map(m => [m.id,m.name])],!desktop)}
          ${select('Position','placement',s,[['center','Center'],['top','Top'],['bottom','Bottom'],['left','Left'],['right','Right']],!desktop)}
          ${range('Overlay size','overlaySize',s,30,100,5)}${toggle('Fullscreen canvas','fullscreen',s,!desktop)}${toggle('Desktop only','desktopOnly',s,!desktop)}
          ${toggle('Click-through','clickThrough',s,!desktop)}${toggle('Hide when paused','hidePaused',s,!desktop)}
          ${toggle('Hide during fullscreen apps','hideFullscreen',s,!desktop)}${toggle('Keep display awake','keepAwake',s,!desktop)}
          <p>Use the tray to recover click-through or hide the overlay.</p>`;
        break;
      }
      case 'aesthetics':
        content = `${toggle('Match album artwork','matchArt',s)}${select('Background','mode',s,modeOptions)}
          ${s.mode === 'zen' ? this.#renderZenEditor(s) : ''}
          <div class="swatches" aria-label="Current palette">${this.data.palette.map(x => `<i style="background:${escapeHtml(x)}" title="${escapeHtml(x)}"></i>`).join('')}</div>
          <div class="panel-buttons"><button class="pill" data-action="lock-palette">${s.paletteLocked ? 'Unlock palette' : 'Lock palette'}</button><button class="pill" data-action="save-palette">Save preset</button><button class="pill" data-action="load-palette">Load preset</button><button class="pill" data-action="reset-palette">Restore automatic</button></div>
          <details><summary>Colours &amp; advanced</summary><div class="advanced-fields">
            ${color('Primary','primary',s)}${color('Secondary','secondary',s)}${color('Accent','accent',s)}
            ${color('Lyric text','textColor',s)}${color('Active word','activeColor',s)}${color('Secondary lyric','inactiveColor',s,'#a6a6b8')}
            ${range('Saturation','saturation',s,0,150)}${range('Brightness','brightness',s,50,140)}
          ${range('Background darkness','darkness',s,0,100)}${range('Glass opacity','glass',s,15,100)}
            ${range('Vignette','vignette',s,0,100)}
            ${range('Glass tint','tint',s,0,100)}${range('Background motion','backgroundMotion',s,0,100)}
            ${range('Grain','grain',s,0,100)}${range('Background blur','blur',s,0,100)}
            ${range('Palette transition','transition',s,0,2000,50,' ms')}${range('Lyric contrast','contrast',s,0,100)}
            ${range('Animation intensity','intensity',s,0,180)}${range('Motion speed','motionSpeed',s,50,170)}
            ${range('Motion blur','motionBlur',s,0,100)}${range('Overlay backdrop','backdrop',s,0,100)}
          </div></details>`;
        break;
      default: {
        const player = this.#anchor?.dataset.player;
        const media = player === 'Spotify' ? this.data.sessions.find(x => /spotify/i.test(x.source)) :
          player === 'Apple Music' ? this.data.sessions.find(x => /apple/.test(x.source.toLowerCase()) && /music/i.test(x.source)) :
          this.data.media;
        const selected = media && media.id === this.data.media?.id;
        const quality = selected ? qualityNames[this.data.quality ?? ''] : undefined;
        const row = (label: string, ok: boolean, detail: string) => `<li><i class="status-dot ${ok ? 'active' : 'pending'}"></i><span>${label}</span><span>${escapeHtml(detail)}</span></li>`;
        title = player || 'Media session';
        content = `<div class="track-diagnostic"><strong>${escapeHtml(media?.title || (media ? 'Unnamed session' : 'No matching session'))}</strong><br><span>${escapeHtml(media?.artist || (media?.playing ? 'Artist not available' : ''))}</span></div>
          ${this.data.error ? `<p role="status">${escapeHtml(this.data.error)}</p>` : ''}
          ${select('Follow player','sourceId',s,[['','Automatic'],...this.data.sessions.map(x=>[x.id,`${x.title || x.source}${x.artist ? ` · ${x.artist}` : ''}`])],!isTauri())}
          <ul class="checklist">${row('Session detected',!!media,media ? (media.playing ? 'Playing' : 'Not playing') : 'Waiting')}
          ${row('Playback metadata',!!media?.title,'Windows media controls')}${row('Song identified',!!media?.title,media?.title || 'Pending')}
          ${row('Artist identified',!!media?.artist,media?.artist || 'Pending')}${row('Position available',!!media?.timelineValid,media?.timelineValid ? 'Tracking' : 'Unavailable')}
          ${row('Lyrics found',!!quality && this.data.quality !== 'unavailable',selected && this.data.loading ? 'Looking up' : this.data.provider || '—')}
          ${row('Timing quality',!!quality && !['unavailable','plain'].includes(this.data.quality ?? ''),quality || '—')}</ul>
          ${selected && this.data.message ? `<p>${escapeHtml(this.data.message)}</p>` : ''}
          <div class="setting-row"><span>Lyrics timing</span><button class="flat" data-action="reset-offset">Reset</button></div>
          <div class="offset-box"><button class="flat" data-action="offset" data-value="1000" title="One second earlier">1 s early</button>
          <button class="flat" data-action="offset" data-value="100" title="100 ms earlier">−</button>
          <output>${this.data.offset ? `${Math.abs(this.data.offset)} ms ${this.data.offset > 0 ? 'early' : 'late'}` : '0 ms'}</output>
          <button class="flat" data-action="offset" data-value="-100" title="100 ms later">+</button>
          <button class="flat" data-action="offset" data-value="-1000" title="One second later">1 s late</button></div>
          ${toggle('Remember timing for this recording','rememberOffset',s)}${toggle('Estimate words from line timings','estimated',s)}
          ${toggle('Look up lyrics with LRCLIB','autoLookup',s)}
          <div class="panel-buttons"><button class="pill" data-action="retry-lyrics">Retry lookup</button><button class="pill" data-action="import-lyrics">Import lyrics</button><button class="pill" data-action="copy-diagnostics">Copy status</button></div>
          <p>LyricMotion ${version}</p>`;
      }
    }
    if (!force && content === this.#panelContent) return;
    if (!force && this.#panel !== 'diagnostics') {
      this.updateSwatches(); return;
    }
    const scroll = panel.scrollTop, expanded = el<HTMLDetailsElement>(panel, 'details')?.open;
    panel.dataset.panel = this.#panel;
    panel.setAttribute('aria-label', title);
    this.#panelContent = content;
    panel.innerHTML = `<div class="panel-title"><h2>${escapeHtml(title)}</h2>${button('Close panel','close-panel','close','flat')}</div><div class="panel-body">${content}</div>`;
    const details = el<HTMLDetailsElement>(panel, 'details');
    if (details && expanded) details.open = true;
    panel.scrollTop = scroll;
    this.#positionPanel();
    if (this.#panel === 'aesthetics') this.#bindZenCanvas();
  }
  refreshPanel() { this.#renderPanel(true); }
  updateSwatches() {
    el(this.host, '#panel')?.querySelectorAll<HTMLElement>('.swatches i').forEach((node, i) => {
      if (!this.data.palette[i] || node.title === this.data.palette[i]) return;
      node.title = this.data.palette[i]; node.style.background = this.data.palette[i];
    });
  }
  update(data: UiData) {
    this.data = data;
    const s = this.styles.find(x => x.id === data.style) ?? this.styles[0];
    if (!s) return;
    el(this.host,'.category').textContent = s.category;
    el(this.host,'.title').textContent = s.name;
    el(this.host,'.description').textContent = s.description;
    const selectButton = el<HTMLButtonElement>(this.host,'[data-action="select"]');
    const selected = data.settings.activeStyle === s.id;
    const c = selected ? `${icon('check')} Selected` : 'Select style';
    if (selectButton.innerHTML !== c) selectButton.innerHTML = c;
    selectButton.classList.toggle('selected',selected);
    selectButton.classList.toggle('primary',!selected);
    selectButton.setAttribute('aria-pressed', String(selected));
    const pin = el<HTMLButtonElement>(this.host,'[data-action="pin"]');
    pin.dataset.active = String(data.settings.pins.includes(s.id));
    pin.setAttribute('aria-pressed', pin.dataset.active);
    pin.title = pin.dataset.active === 'true' ? 'Unpin style' : 'Pin style';
    this.host.querySelectorAll<HTMLButtonElement>('.pages button').forEach(b => b.setAttribute('aria-current',String(b.dataset.value === s.id)));
    this.#markTiles();
    const enable = (name: string, active: boolean) => el(this.host, `[data-action="${name}"]`).setAttribute('aria-pressed', String(active));
    enable('demo',data.demo); enable('live',!data.demo);
    el(this.host,'.transport-controls').hidden = !data.demo && !data.rehearsal;
    el(this.host,'.scrub').hidden = false;
    const pause = el<HTMLButtonElement>(this.host,'[data-action="pause"]');
    const sound = el<HTMLButtonElement>(this.host,'[data-action="sound"]');
    sound.hidden = !data.demo;
    this.#iconLabel(pause, data.paused ? 'Resume demo' : 'Pause demo', data.paused ? 'play' : 'pause');
    this.#iconLabel(sound, data.sound ? 'Mute demo audio' : 'Enable demo audio', data.sound ? 'sound' : 'mute');
    const caption = data.demo ? `Original demo · ${demoName}` : data.rehearsal ? 'Local rehearsal' : data.media?.title ?
      `${data.media.title}${data.media.artist ? ` — ${data.media.artist}` : ''}${data.media.playing ? '' : ' · Paused'}` : 'No active music session';
    el(this.host,'.track-caption').textContent = caption;
    this.host.querySelectorAll<HTMLButtonElement>('[data-player]').forEach(b => {
      const matched = data.sessions.filter(m => b.dataset.player === 'Spotify' ? /spotify/i.test(m.source) : b.dataset.player === 'Apple Music' ? /apple.*music/i.test(m.source) : !/spotify|apple.*music/i.test(m.source));
      el(b,'.status-dot').className = `status-dot ${matched.some(x => x.playing && x.timelineValid) ? 'active' : matched.length ? 'pending' : data.error ? 'error' : ''}`;
      b.title = `${b.dataset.player}: ${matched.some(x => x.playing && x.timelineValid) ? 'connected' : matched.length ? 'detected' : data.error ? 'media error' : 'inactive'}`;
    });
    this.#renderPanel();
  }
  #iconLabel(button: HTMLButtonElement, label: string, glyph: string) {
    if (button.title === label) return;
    button.title = label; button.setAttribute('aria-label',label); button.innerHTML = icon(glyph);
  }
  displayEmpty(message: string, plain = '') {
    const empty = el(this.host,'.live-empty'), view = el(this.host,'.plain-view');
    if (empty.textContent !== message) empty.textContent = message;
    if (view.textContent !== plain) view.textContent = plain;
    empty.hidden = !message || !!plain;
    view.hidden = !plain;
  }
  tick(transport: ReturnType<typeof projectTransport>, live: boolean) {
    const control = el<HTMLInputElement>(this.host,'[data-scrub]');
    const progress = el<HTMLProgressElement>(this.host,'.live-progress');
    const end = el(this.host,'[data-end]');
    const pos = el(this.host,'[data-pos]');
    const stamp = formatTransportTime(transport.playhead);
    const endStamp = formatTransportTime(transport.duration);
    if (pos.textContent !== stamp) pos.textContent = stamp;
    if (end.textContent !== endStamp) end.textContent = endStamp;
    if (control.hidden !== live) { control.hidden = live; progress.hidden = !live; }
    if (live) {
      progress.value = transport.fraction;
      progress.classList.toggle('unavailable', transport.duration === null || transport.playhead === null);
    } else {
      const max = String(Math.round(transport.duration ?? demoDuration));
      if (control.max !== max) control.max = max;
      if (document.activeElement !== control) control.value = String(Math.round(transport.playhead ?? 0));
    }
  }
  notice(text: string) {
    let toast = this.host.querySelector('.notice');
    if (!toast) { toast = document.createElement('div'); toast.className = 'notice'; toast.setAttribute('role','status'); this.host.append(toast); }
    toast.textContent = text;
    clearTimeout(this.#noticeTimer);
    this.#noticeTimer = window.setTimeout(() => toast?.remove(), 4300);
  }
  error(text: string) { const b = el(this.host,'.status-banner'); b.textContent = text; b.hidden = !text; }
  resetSize() { this.handlers.setting('size', defaults.size); this.refreshPanel(); }

  #renderZenEditor(s: Settings): string {
    const points = s.zenPoints || defaults.zenPoints;
    if (this.#zenSelected >= points.length) this.#zenSelected = Math.max(0, points.length - 1);
    const sel = points[this.#zenSelected] || points[0];
    const blendModes = [
      ['normal', 'Additive'],
      ['screen', 'Screen'],
      ['overlay', 'Soft overlay'],
      ['lighten', 'Lighten'],
    ];
    return `<div class="zen-editor" role="region" aria-label="Zen Gradient Editor">
      <div class="zen-canvas-wrap">
        <canvas class="zen-canvas" width="280" height="125" title="Drag to position a light" aria-hidden="true"></canvas>
      </div>
      <div class="zen-controls">
        <div class="zen-node-header">
          <label for="zen-point">Light</label><select id="zen-point" data-zen-point>${points.map((_, i) =>
            `<option value="${i}" ${i === this.#zenSelected ? 'selected' : ''}>Point ${i + 1}</option>`).join('')}</select>
          <span class="zen-node-coord">(${Math.round(sel.x * 100)}%, ${Math.round(sel.y * 100)}%)</span>
        </div>
        ${toggle('Use palette colours','zenAuto',s)}
        <div class="zen-precision"><label>X % <input type="number" data-zen-position="x" min="0" max="100" value="${Math.round(sel.x * 100)}"></label><label>Y % <input type="number" data-zen-position="y" min="0" max="100" value="${Math.round(sel.y * 100)}"></label></div>
        <div class="setting-row"><label for="zen-color">Point colour</label><div class="zen-precision">
          <input id="zen-color" type="color" class="color-input" data-zen-color value="${escapeHtml(sel.color)}">
          <input type="text" aria-label="Point colour hex" maxlength="7" data-zen-hex value="${escapeHtml(sel.color)}"></div></div>
        <div class="setting-range"><label class="setting-row" for="zen-spread"><span>Spread</span><output>${sel.spread.toFixed(1)}</output></label><input id="zen-spread" type="range" data-zen-spread="1" min="0.5" max="3.5" step="0.1" value="${sel.spread}"></div>
        <div class="setting-range"><label class="setting-row" for="zen-intensity"><span>Intensity</span><output>${Math.round(sel.intensity * 100)}%</output></label><input id="zen-intensity" type="range" data-zen-intensity="1" min="0.1" max="2.0" step="0.05" value="${sel.intensity}"></div>
        ${range('Rotation','zenRotation',s,-180,180,1,'°')}
        <div class="panel-buttons">
          <button type="button" class="pill" data-action="zen-add-point" ${points.length >= 6 ? 'disabled' : ''}>+ Add point</button>
          <button type="button" class="pill" data-action="zen-remove-point" ${points.length <= 1 ? 'disabled' : ''}>− Remove</button>
        </div>
        <label class="setting-row"><span>Blend mode</span><select data-setting="zenBlendMode">${blendModes.map(([val, name]) => `<option value="${val}" ${s.zenBlendMode === val ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
        <div class="panel-buttons">
          <button type="button" class="pill" data-action="zen-save-preset">Save gradient</button>
          <button type="button" class="pill" data-action="zen-load-preset">Load gradient</button>
          <button type="button" class="pill" data-action="zen-reset">Reset layout</button>
        </div>
      </div>
    </div>`;
  }

  #bindZenCanvas() {
    const canvas = this.host.querySelector<HTMLCanvasElement>('.zen-canvas');
    if (!canvas) return;
    this.#drawZenCanvas(canvas);

    canvas.onpointerdown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      this.#zenDragging = true;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width;
      const cy = (e.clientY - rect.top) / rect.height;
      const points = this.data.settings.zenPoints || defaults.zenPoints;
      let closestIdx = 0, closestDist = Infinity;
      points.forEach((pt, i) => {
        const dx = pt.x - cx, dy = pt.y - cy;
        const dist = Math.hypot(dx * rect.width, dy * rect.height);
        if (dist < closestDist) { closestDist = dist; closestIdx = i; }
      });
      this.#zenSelected = closestIdx;
      const updated = points.map((p, i) => i === closestIdx ? { ...p, x: Math.max(0, Math.min(1, cx)), y: Math.max(0, Math.min(1, cy)) } : p);
      this.handlers.setting('zenPoints', updated);
      this.#drawZenCanvas(canvas);
      this.#updateZenHeader();
    };

    canvas.onpointermove = (e: PointerEvent) => {
      if (!this.#zenDragging) return;
      const rect = canvas.getBoundingClientRect();
      const cx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const cy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const points = this.data.settings.zenPoints || defaults.zenPoints;
      const updated = points.map((p, i) => i === this.#zenSelected ? { ...p, x: cx, y: cy } : p);
      this.handlers.setting('zenPoints', updated);
      this.#drawZenCanvas(canvas);
      this.#updateZenHeader();
    };

    canvas.onpointerup = canvas.onpointercancel = (e: PointerEvent) => {
      this.#zenDragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
      this.#renderPanel(true);
    };
  }

  #drawZenCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, w, h);

    const points = this.data.settings.zenPoints || defaults.zenPoints;
    const colours = [this.data.palette[1],this.data.palette[2],this.data.palette[3],this.data.palette[2]];
    const pointColor = (i: number) => this.data.settings.zenAuto ? colours[i % colours.length] ?? points[i].color : points[i].color;
    points.forEach((pt, i) => {
      const px = pt.x * w, py = pt.y * h;
      const radius = Math.max(18, pt.spread * 38);
      const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
      grad.addColorStop(0, pointColor(i));
      grad.addColorStop(1, 'transparent');
      ctx.globalAlpha = Math.min(1, pt.intensity * 0.72);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    points.forEach((pt, i) => {
      const px = pt.x * w, py = pt.y * h;
      const isSel = i === this.#zenSelected;
      if (isSel) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = pointColor(i);
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffffbb';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), px, py);
    });
  }

  #updateZenHeader() {
    const points = this.data.settings.zenPoints || defaults.zenPoints;
    const sel = points[this.#zenSelected];
    if (!sel) return;
    const header = this.host.querySelector('.zen-node-coord');
    if (header) header.textContent = `(${Math.round(sel.x * 100)}%, ${Math.round(sel.y * 100)}%)`;
  }
}
import { version } from '../package.json';

/* Galleria — site engine
   vanilla, dependency-free, progressive */
(() => {
  'use strict';
  window.__galleria = true;

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const html = document.documentElement;
  const nav = $('[data-nav]');
  const menu = $('[data-menu]');
  const burger = $('[data-burger]');
  const main = $('#main');

  /* ── shared frame loop ──────────────────────────────────────── */
  const frameFns = new Set();
  function loop() {
    frameFns.forEach(fn => fn());
    requestAnimationFrame(loop);
  }
  if (!reduced) requestAnimationFrame(loop);
  const webkitScroll = () => html.scrollHeight - innerHeight;

  /* ── entrance (no curtain, no waiting) ─────────────────────── */
  requestAnimationFrame(() => requestAnimationFrame(() => html.classList.add('loaded')));

  /* ── navigation: depth, theme, active section, progress ────── */
  const progress = $('.progress i');
  const navSections = $$('[data-nav-theme]');
  const navLinks = $$('[data-nav-link]');
  let lastY = scrollY;
  let ticking = false;

  function paintNav() {
    const y = scrollY;
    const max = Math.max(1, webkitScroll());
    if (progress) progress.style.transform = `scaleX(${clamp(y / max, 0, 1).toFixed(4)})`;

    nav?.classList.toggle('scrolled', y > 24);
    if (nav && !html.classList.contains('menu-open')) {
      if (y > lastY + 8 && y > 480) nav.classList.add('hidden');
      else if (y < lastY - 6 || y < 480) nav.classList.remove('hidden');
    }
    lastY = y;

    // which band sits under the bar?
    const probe = 72;
    let theme = 'light';
    let active = '';
    navSections.forEach(sec => {
      const r = sec.getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) {
        theme = sec.dataset.navTheme || 'light';
        if (sec.id) active = sec.id;
      }
    });
    nav?.classList.toggle('on-dark', theme === 'dark');
    html.dataset.navTheme = theme;
    navLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + active));
    ticking = false;
  }

  addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(paintNav); ticking = true; }
  }, { passive: true });
  paintNav();

  /* ── menu ───────────────────────────────────────────────────── */
  let menuOpen = false;
  let lastFocus = null;
  if (menu) menu.inert = true;

  function focusables() {
    return $$('a[href], button:not([disabled])', menu).filter(el => el.offsetParent !== null);
  }

  function setMenu(open, returnFocus = true) {
    if (!menu) return;
    menuOpen = open;
    html.classList.toggle('menu-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    menu.inert = !open;
    burger?.setAttribute('aria-expanded', String(open));
    burger?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (main) main.inert = open;
    if (open) {
      lastFocus = document.activeElement === document.body ? burger : document.activeElement;
      nav?.classList.remove('hidden');
      setTimeout(() => menu.focus({ preventScroll: true }), 420);
    } else if (returnFocus) {
      (lastFocus instanceof HTMLElement ? lastFocus : burger)?.focus();
    }
  }

  burger?.addEventListener('click', () => setMenu(!menuOpen));
  menu?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); setMenu(false); return; }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) setMenu(false); });

  /* ── anchors (native smooth scroll, no hijacking) ──────────── */
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const hash = a.getAttribute('href');
    if (!hash || hash === '#') return;
    const el = hash === '#top' ? document.body : $(hash);
    if (!el) return;
    e.preventDefault();
    if (menuOpen) setMenu(false, false);
    if (hash === '#top') scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    try { history.replaceState(null, '', hash); } catch {}
  });

  /* ── reveals ────────────────────────────────────────────────── */
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      io.unobserve(en.target);
    });
  }, { threshold: .1, rootMargin: '0px 0px -7% 0px' });
  $$('.reveal').forEach(el => io.observe(el));

  /* ── hero parallax ─────────────────────────────────────────── */
  const hero = $('.hero');
  const heroStage = $('.hero-stage');
  if (hero && heroStage && fine && !reduced) {
    let tx = 0, ty = 0, px = 0, py = 0;
    hero.addEventListener('pointermove', e => {
      const r = heroStage.getBoundingClientRect();
      tx = clamp((e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1), -1, 1);
      ty = clamp((e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1), -1, 1);
    }, { passive: true });
    frameFns.add(() => {
      px += (tx - px) * .055;
      py += (ty - py) * .055;
      hero.style.setProperty('--px', px.toFixed(4));
      hero.style.setProperty('--py', py.toFixed(4));
    });
  }

  /* ── manifesto: ink across the words ───────────────────────── */
  {
    const line = $('[data-words]');
    if (line) {
      const split = el => [...el.childNodes].forEach(node => {
        if (node.nodeType === 3) {
          const frag = document.createDocumentFragment();
          node.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) frag.append(part);
            else {
              const w = document.createElement('span');
              w.className = 'w';
              w.textContent = part;
              frag.append(w);
            }
          });
          node.replaceWith(frag);
        } else if (node.nodeType === 1) split(node);
      });
      split(line);
      const words = $$('.w', line);
      if (reduced) words.forEach(w => w.style.opacity = 1);
      else {
        words.forEach(w => w.style.willChange = 'opacity');
        frameFns.add(() => {
          const r = line.getBoundingClientRect();
          if (r.bottom < -100 || r.top > innerHeight + 100) return;
          const p = clamp((innerHeight * .82 - r.top) / (innerHeight * .52), 0, 1);
          words.forEach((w, i) => {
            w.style.opacity = (.14 + .86 * clamp(p * (words.length + 5) - i, 0, 1)).toFixed(3);
          });
        });
      }
    }
  }

  /* ── palette ────────────────────────────────────────────────── */
  const PALETTES = {
    coral: 'Coral — warm, low afternoon light',
    ocean: 'Ocean — clear, coastal daylight',
    lavender: 'Lavender — soft, quiet dusk',
    mauve: 'Mauve — dusty rose at golden hour',
    sage: 'Sage — green, calm and close to nature'
  };
  const paletteBtns = $$('[data-pal]');
  const paletteStatus = $('[data-palette-status]');
  let themeTimer;

  function applyPalette(key, animate = true) {
    if (!PALETTES[key]) return;
    if (animate && !reduced) {
      html.classList.add('theming');
      clearTimeout(themeTimer);
      themeTimer = setTimeout(() => html.classList.remove('theming'), 680);
    }
    html.dataset.palette = key;
    paletteBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pal === key)));
    if (paletteStatus) paletteStatus.textContent = PALETTES[key];
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#f4f0e8');
    try { localStorage.setItem('galleria-palette', key); } catch {}
  }

  let savedPalette = null;
  try { savedPalette = localStorage.getItem('galleria-palette'); } catch {}
  if (savedPalette && PALETTES[savedPalette]) applyPalette(savedPalette, false);
  else applyPalette(html.dataset.palette || 'coral', false);

  paletteBtns.forEach(btn => btn.addEventListener('click', () => applyPalette(btn.dataset.pal, true)));

  /* ── wall filters ───────────────────────────────────────────── */
  {
    const grid = $('[data-wall-grid]');
    const buttons = $$('[data-filter]');
    const count = $('[data-wall-count]');
    const note = $('[data-wall-note]');
    if (grid) {
      const frames = $$('.frame', grid);
      buttons.forEach(btn => btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        buttons.forEach(b => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        let visible = 0;
        frames.forEach(f => {
          const cats = (f.dataset.cats || '').split(/\s+/);
          const show = filter === 'all' || cats.includes(filter);
          f.classList.toggle('is-hidden', !show);
          if (show) {
            visible++;
            f.classList.remove('just-in');
            void f.offsetWidth;
            f.classList.add('just-in');
          }
        });
        if (note) note.hidden = filter !== 'all';
        if (count) count.textContent = String(visible).padStart(2, '0');
      }));
    }
  }

  /* ── darkroom develop demo ─────────────────────────────────── */
  {
    const dev = $('[data-dev]');
    const stage = $('[data-dev-stage]');
    const image = $('[data-dev-img]');
    const sliders = $$('[data-dev-slider]');
    const compare = $('[data-compare]');
    const reset = $('[data-dev-reset]');
    const hist = $('[data-hist]');
    if (dev && stage && image) {
      const values = { exposure: 0, contrast: 0, warmth: 0, saturation: 0 };

      const fmt = (key, v) => {
        if (key === 'exposure') {
          const n = v / 100;
          return (n > 0 ? '+' : '') + n.toFixed(2);
        }
        return (v > 0 ? '+' : '') + String(v);
      };

      const filterFor = v => {
        const brightness = 1 + (v.exposure / 100) * .26;
        const contrast = 1 + (v.contrast / 100) * .34;
        const saturation = 1 + (v.saturation / 100) * .5;
        return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturation.toFixed(3)})`;
      };

      function updateRange(input) {
        const min = Number(input.min || 0), max = Number(input.max || 100);
        const p = ((Number(input.value) - min) / Math.max(1, max - min)) * 100;
        input.style.setProperty('--p', p.toFixed(2) + '%');
      }

      let histQueued = false;
      function requestHist() {
        if (histQueued) return;
        histQueued = true;
        requestAnimationFrame(() => { histQueued = false; drawHist(); });
      }

      function apply() {
        const filter = filterFor(values);
        stage.style.setProperty('--dev-filter', filter);
        const warm = values.warmth / 100;
        stage.classList.toggle('is-warm', warm > .01);
        stage.classList.toggle('is-cool', warm < -.01);
        stage.style.setProperty('--warm-op', (Math.abs(warm) * .5).toFixed(3));
        sliders.forEach(s => {
          const key = s.dataset.devSlider;
          const out = $(`[data-out="${key}"]`);
          if (out) out.textContent = fmt(key, values[key]);
          updateRange(s);
        });
        requestHist();
      }

      sliders.forEach(slider => {
        slider.addEventListener('input', () => {
          values[slider.dataset.devSlider] = Number(slider.value);
          apply();
        });
        updateRange(slider);
      });

      compare?.addEventListener('input', () => {
        stage.style.setProperty('--cut', compare.value + '%');
        updateRange(compare);
      });
      if (compare) updateRange(compare);

      reset?.addEventListener('click', () => {
        Object.keys(values).forEach(k => values[k] = 0);
        sliders.forEach(s => { s.value = '0'; });
        compare && (compare.value = '55');
        stage.style.setProperty('--cut', '55%');
        apply();
      });

      /* live RGB histogram from the same pixels the filter acts on */
      let histReady = false;
      let canvasFilterOK = true;
      function initHist() {
        if (!hist || histReady) return;
        const ctx = hist.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        histReady = true;
        requestHist();
      }

      function drawHist() {
        if (!hist || !image.complete || !image.naturalWidth) return;
        const ctx = hist.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        const W = 300, H = 96;
        hist.width = 600; hist.height = 192;
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const sw = 240, sh = 163;
        const off = document.createElement('canvas');
        off.width = sw; off.height = sh;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (!octx) return;
        try {
          if ('filter' in octx) {
            octx.filter = filterFor(values);
            if (octx.filter === 'none' && filterFor(values) !== 'none') canvasFilterOK = false;
          }
          octx.drawImage(image, 0, 0, sw, sh);
        } catch { return; }

        let data;
        try { data = octx.getImageData(0, 0, sw, sh).data; } catch { return; }
        const R = new Uint32Array(256), G = new Uint32Array(256), B = new Uint32Array(256);
        let peak = 1;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          R[r]++; G[g]++; B[b]++;
        }
        for (let i = 2; i < 254; i++) {
          peak = Math.max(peak, R[i], G[i], B[i]);
        }

        // grid
        ctx.strokeStyle = 'rgba(255,255,255,.07)';
        ctx.lineWidth = 1;
        for (let x = 1; x < 4; x++) {
          ctx.beginPath(); ctx.moveTo((W / 4) * x, 0); ctx.lineTo((W / 4) * x, H); ctx.stroke();
        }

        const drawChannel = (arr, fill, stroke) => {
          ctx.beginPath();
          ctx.moveTo(0, H);
          for (let i = 0; i < 256; i++) {
            const x = (i / 255) * W;
            const y = H - Math.sqrt(arr[i] / peak) * (H - 10);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(W, H);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = .8;
          ctx.stroke();
        };

        ctx.globalCompositeOperation = 'lighter';
        drawChannel(R, 'rgba(255,74,74,.18)', 'rgba(255,110,110,.85)');
        drawChannel(G, 'rgba(92,255,134,.15)', 'rgba(120,255,160,.8)');
        drawChannel(B, 'rgba(90,140,255,.2)', 'rgba(130,170,255,.9)');
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.beginPath(); ctx.moveTo(0, H - .5); ctx.lineTo(W, H - .5); ctx.stroke();
      }

      if ('IntersectionObserver' in window && hist) {
        const hio = new IntersectionObserver(entries => {
          entries.forEach(en => { if (en.isIntersecting) { initHist(); hio.disconnect(); } });
        }, { threshold: .2 });
        hio.observe(hist);
      } else initHist();

      if (image.complete) initHist();
      image.addEventListener('load', () => { initHist(); requestHist(); }, { once: true });
      apply();
    }
  }

  /* ── download cards + latest release ───────────────────────── */
  (async () => {
    const cards = $$('[data-platform]');
    const primaryHero = $('[data-dl-primary]');
    const heroLabel = $('[data-dl-label]');
    const ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
    let os = 'linux';
    if (/mac|iphone|ipad/i.test(ua)) os = 'macos';
    else if (/win/i.test(ua)) os = 'windows';
    else if (/linux|android/i.test(ua)) os = 'linux';

    const osLabel = { linux: 'Linux', macos: 'macOS', windows: 'Windows' };
    if (heroLabel) heroLabel.textContent = `Download for ${osLabel[os]}`;

    const setHref = (el, url) => { if (el && url) el.href = url; };
    const setText = (root, sel, txt) => { const el = $(sel, root); if (el && txt) el.textContent = txt; };
    const pick = (assets, re) => assets.find(a => re.test(a.name));

    try {
      if (cards.length || primaryHero) {
        let data = null;
        try {
          const cached = sessionStorage.getItem('galleria-release');
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.at && Date.now() - parsed.at < 3600e3) data = parsed.data;
          }
        } catch {}

        if (!data) {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 6000);
          try {
            const res = await fetch('https://api.github.com/repos/ARYAN007H/galleria/releases/latest', {
              headers: { Accept: 'application/vnd.github+json' },
              signal: ctl.signal
            });
            if (res.ok) data = await res.json();
          } finally { clearTimeout(timer); }
          if (data) { try { sessionStorage.setItem('galleria-release', JSON.stringify({ at: Date.now(), data })); } catch {} }
        }

        if (data) {
          const assets = Array.isArray(data.assets) ? data.assets : [];
          const version = data.tag_name || '';
          $$('[data-version]').forEach(el => { if (version) el.textContent = version; });

          const mapping = {
            linux: {
              primary: pick(assets, /amd64\.AppImage$/i) || pick(assets, /\.AppImage$/i),
              label: '.AppImage',
              alt: { deb: pick(assets, /\.deb$/i), rpm: pick(assets, /\.rpm$/i) }
            },
            macos: {
              primary: os === 'macos'
                ? (pick(assets, /aarch64\.dmg$/i) || pick(assets, /x64\.dmg$/i))
                : (pick(assets, /x64\.dmg$/i) || pick(assets, /aarch64\.dmg$/i)),
              label: '.dmg',
              alt: { arm: pick(assets, /aarch64\.dmg$/i), intel: pick(assets, /x64\.dmg$/i) }
            },
            windows: {
              primary: pick(assets, /x64-setup\.exe$/i) || pick(assets, /\.exe$/i) || pick(assets, /\.msi$/i),
              label: '.exe',
              alt: { msi: pick(assets, /\.msi$/i) }
            }
          };

          cards.forEach(card => {
            const platform = card.dataset.platform;
            const m = mapping[platform];
            if (!m) return;
            if (m.primary) {
              setHref($('[data-download]', card), m.primary.browser_download_url);
              setText(card, '[data-file]', m.label);
            }
            Object.entries(m.alt || {}).forEach(([key, asset]) => {
              if (asset) setHref($(`[data-alt="${key}"]`, card), asset.browser_download_url);
            });
            if (platform === os) {
              card.classList.add('is-recommended');
              const badge = $('.recommended', card);
              if (badge) { badge.hidden = false; badge.textContent = 'Recommended for you'; }
            }
          });

          const chosen = (mapping[os] && mapping[os].primary) || mapping.linux.primary;
          if (chosen && primaryHero) {
            primaryHero.href = chosen.browser_download_url;
            if (heroLabel) heroLabel.textContent = `Download for ${osLabel[os]} · ${mapping[os] ? mapping[os].label.replace('.', '') : ''}`.trim();
            if (chosen.size) {
              const mb = Math.max(1, Math.round(chosen.size / 1048576));
              const sizeEl = $('[data-asset-size]');
              if (sizeEl) sizeEl.textContent = `≈ ${mb} MB · ${osLabel[os]}`;
            }
          }
        }
      }
    } catch {
      /* leave the release-page fallbacks in place */
    }
  })();

  /* ── cursor ─────────────────────────────────────────────────── */
  if (fine && !reduced) {
    const cursor = $('.cursor');
    if (cursor) {
      html.classList.add('has-cursor');
      cursor.classList.add('is-hidden');
      let mx = innerWidth / 2, my = innerHeight / 2, cx = mx, cy = my;
      addEventListener('pointermove', e => {
        mx = e.clientX; my = e.clientY;
        cursor.classList.remove('is-hidden');
      }, { passive: true });
      addEventListener('pointerleave', () => cursor.classList.add('is-hidden'));
      frameFns.add(() => {
        cx += (mx - cx) * .3;
        cy += (my - cy) * .3;
        cursor.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
      });
      document.addEventListener('pointerover', e => {
        const view = e.target.closest?.('.frame, .app-window, .print, .grading-card, .mini-mosaic');
        const link = e.target.closest?.('a, button, input, .filter, .mood');
        cursor.classList.toggle('is-view', !!view);
        cursor.classList.toggle('is-link', !view && !!link);
      });
    }
  }

  /* ── magnetic buttons ───────────────────────────────────────── */
  if (fine && !reduced) {
    $$('[data-magnet]').forEach(el => {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * .16;
        const y = (e.clientY - r.top - r.height / 2) * .22;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ── clock + year ───────────────────────────────────────────── */
  {
    const clock = $('[data-clock]');
    const tick = () => {
      if (!clock) return;
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      clock.textContent = `Local time · ${t}`;
    };
    tick(); setInterval(tick, 30000);
    const year = $('[data-year]');
    if (year) year.textContent = new Date().getFullYear();
  }
})();

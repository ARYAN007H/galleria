/* Galleria Expressive — site engine
   vanilla, dependency-free, degrades gracefully */

(() => {
  'use strict';

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine    = matchMedia('(pointer: fine)').matches;
  const html    = document.documentElement;

  /* ── shared rAF hub ─────────────────────────────────────────── */
  const onFrame = new Set();
  requestAnimationFrame(function loop() {
    onFrame.forEach(fn => fn());
    requestAnimationFrame(loop);
  });
  const maxScroll = () => html.scrollHeight - innerHeight;

  /* ── loader (waits for the counter AND web fonts, so the curtain
        hides the fallback→webfont reflow instead of exposing it) ── */
  const fontsSettled = new Promise(resolve => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    setTimeout(fin, 2400); // never hold the curtain hostage
    const link = $('link[href*="fonts.googleapis"]');
    const afterCss = () => { (document.fonts ? document.fonts.ready : Promise.resolve()).then(fin, fin); };
    if (!link || link.media === 'all') afterCss();
    else {
      link.addEventListener('load', afterCss, { once: true });
      link.addEventListener('error', fin, { once: true });
    }
  });
  const loader = $('#loader');
  {
    const count = $('[data-loader-count]');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      html.classList.add('loaded');
      loader?.classList.add('done');
      setTimeout(() => loader?.remove(), 1500);
    };
    if (reduced || !loader) { finish(); loader?.remove(); }
    else {
      const t0 = performance.now(), DUR = 900;
      let counted = false;
      fontsSettled.then(() => { if (counted) finish(); });
      (function tick() {
        const p = Math.min(1, (performance.now() - t0) / DUR);
        count.textContent = String(Math.round(p * 100)).padStart(2, '0');
        if (p < 1) { requestAnimationFrame(tick); return; }
        counted = true;
        fontsSettled.then(finish);
      })();
      setTimeout(finish, 3000); // hard failsafe
    }
  }

  /* ── smooth scroll (desktop wheel lerp; everything else native) */
  let scrollTarget = scrollY, scrollCurrent = scrollY;
  if (fine && !reduced) {
    addEventListener('wheel', e => {
      if (e.ctrlKey || html.classList.contains('menu-open')) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      scrollTarget = clamp(scrollTarget + dy, 0, maxScroll());
    }, { passive: false });

    onFrame.add(() => {
      const max = maxScroll();
      scrollCurrent = clamp(scrollCurrent, 0, max);
      const d = scrollTarget - scrollCurrent;
      if (Math.abs(d) < .1) { scrollTarget = scrollCurrent = scrollY; return; }
      scrollCurrent += d * .094;
      scrollTo(0, scrollCurrent);
    });

    addEventListener('scroll', () => {
      if (Math.abs(scrollY - scrollCurrent) > 2) scrollTarget = scrollCurrent = scrollY;
    }, { passive: true });
  }

  const scrollToY = y => {
    y = clamp(y, 0, maxScroll());
    if (fine && !reduced) scrollTarget = y;
    else scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  };

  /* ── nav + progress ─────────────────────────────────────────── */
  const nav = $('[data-nav]');
  const bar = $('.progress i');
  let lastY = scrollY;
  onFrame.add(() => {
    if (bar) bar.style.transform = `scaleX(${(scrollY / Math.max(1, maxScroll())).toFixed(4)})`;
    if (nav) {
      nav.classList.toggle('scrolled', scrollY > 30);
      if (!html.classList.contains('menu-open')) {
        if (scrollY > lastY + 6 && scrollY > 320) nav.classList.add('hidden');
        else if (scrollY < lastY - 4 || scrollY <= 320) nav.classList.remove('hidden');
      }
      lastY = scrollY;
    }
  });

  /* ── reveals ────────────────────────────────────────────────── */
  {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    $$('.reveal').forEach(el => io.observe(el));
  }

  /* ── hero collage parallax ──────────────────────────────────── */
  {
    const stage = $('.hero-stage');
    if (stage && fine && !reduced) {
      let tx = 0, ty = 0, px = 0, py = 0;
      stage.closest('.hero').addEventListener('pointermove', e => {
        const r = stage.getBoundingClientRect();
        tx = clamp((e.clientX - (r.left + r.width / 2)) / r.width, -1, 1);
        ty = clamp((e.clientY - (r.top + r.height / 2)) / r.height, -1, 1);
      });
      onFrame.add(() => {
        px += (tx - px) * .055;
        py += (ty - py) * .055;
        stage.style.setProperty('--px', px.toFixed(4));
        stage.style.setProperty('--py', py.toFixed(4));
      });
    }
  }

  /* ── manifesto: word-by-word ink reveal ─────────────────────── */
  {
    const line = $('[data-words]');
    if (line) {
      const split = el => [...el.childNodes].forEach(node => {
        if (node.nodeType === 3) {
          const frag = document.createDocumentFragment();
          node.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) frag.append(part);
            else { const w = document.createElement('span'); w.className = 'w'; w.textContent = part; frag.append(w); }
          });
          node.replaceWith(frag);
        } else if (node.nodeType === 1) split(node);
      });
      split(line);
      const words = $$('.w', line);
      if (reduced) words.forEach(w => w.style.opacity = 1);
      else onFrame.add(() => {
        const r = line.getBoundingClientRect();
        const p = clamp((innerHeight * .86 - r.top) / (innerHeight * .52), 0, 1);
        const n = words.length;
        words.forEach((w, i) => {
          w.style.opacity = (.13 + .87 * clamp(p * (n + 4) - i, 0, 1)).toFixed(3);
        });
      });
    }
  }

  /* ── horizontal gallery ─────────────────────────────────────── */
  {
    const sticky = $('[data-horizontal]');
    const track  = $('.g-track');
    const port   = $('.g-viewport');
    const gBar   = $('[data-g-bar]');
    const gNow   = $('[data-g-now]');
    const frames = $$('.frame');
    if (sticky && track && port) {
      onFrame.add(() => {
        const r = sticky.getBoundingClientRect();
        const total = Math.max(1, sticky.offsetHeight - innerHeight);
        const p = clamp(-r.top / total, 0, 1);
        const dist = Math.max(0, track.scrollWidth - port.clientWidth);
        track.style.transform = `translate3d(${(-p * dist).toFixed(1)}px,0,0)`;
        if (gBar) gBar.style.transform = `scaleX(${p.toFixed(4)})`;
        if (gNow) gNow.textContent = String(clamp(Math.round(p * (frames.length - 1)) + 1, 1, frames.length)).padStart(2, '0');
      });
    }
  }

  /* ── before / after comparator ──────────────────────────────── */
  {
    const ba = $('[data-ba]');
    if (ba) {
      const range = $('.ba-range', ba);
      const setCut = v => ba.style.setProperty('--cut', v + '%');
      range?.addEventListener('input', () => { ba.classList.remove('ba-sweep'); setCut(range.value); });
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
          if (e.isIntersecting && !reduced) {
            ba.classList.add('ba-sweep');
            setTimeout(() => ba.classList.remove('ba-sweep'), 2100);
            obs.disconnect();
          }
        });
      }, { threshold: .55 });
      io.observe(ba);
    }
  }

  /* ── palette switcher ───────────────────────────────────────── */
  {
    const pals = $$('.pal');
    const KEYS = ['ocean', 'lavender', 'mauve', 'sage', 'coral'];
    let tT;
    const apply = (key, animate) => {
      if (animate && !reduced) {
        html.classList.add('theming');
        clearTimeout(tT);
        tT = setTimeout(() => html.classList.remove('theming'), 680);
      }
      html.dataset.palette = key;
      pals.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pal === key)));
      try { localStorage.setItem('galleria-palette', key); } catch {}
    };
    let saved = null;
    try { saved = localStorage.getItem('galleria-palette'); } catch {}
    if (saved && KEYS.includes(saved)) apply(saved, false);
    pals.forEach(b => b.addEventListener('click', () => apply(b.dataset.pal, true)));
  }

  /* ── stat counters ──────────────────────────────────────────── */
  {
    const stats = $('[data-stats]');
    if (stats) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          obs.disconnect();
          $$('[data-count]', stats).forEach(el => {
            const end = parseInt(el.dataset.count, 10) || 0;
            const suffix = el.dataset.suffix || '';
            if (reduced || end === 0) { el.textContent = end + suffix; return; }
            const t0 = performance.now(), DUR = 1500;
            (function tick() {
              const p = Math.min(1, (performance.now() - t0) / DUR);
              const eased = 1 - Math.pow(1 - p, 4);
              el.textContent = Math.round(end * eased) + suffix;
              if (p < 1) requestAnimationFrame(tick);
            })();
          });
        });
      }, { threshold: .4 });
      io.observe(stats);
    }
  }

  /* ── custom cursor ──────────────────────────────────────────── */
  {
    const cur = $('.cursor');
    if (cur && fine) {
      let mx = innerWidth / 2, my = innerHeight / 2, cx = mx, cy = my;
      addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
      onFrame.add(() => {
        if (reduced) { cx = mx; cy = my; }
        else { cx += (mx - cx) * .22; cy += (my - cy) * .22; }
        cur.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
      });
      document.addEventListener('pointerover', e => {
        const view = e.target.closest?.('[data-cursor]');
        const link = e.target.closest?.('a, button, .ba-range');
        cur.classList.toggle('is-view', !!view);
        cur.classList.toggle('is-link', !view && !!link);
      });
    }
  }

  /* ── magnetic buttons ───────────────────────────────────────── */
  if (fine && !reduced) {
    $$('[data-magnet]').forEach(el => {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * .22;
        const y = (e.clientY - r.top - r.height / 2) * .34;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ── mobile menu ────────────────────────────────────────────── */
  const burger = $('[data-burger]');
  const menu = $('[data-menu]');
  const setMenu = open => {
    html.classList.toggle('menu-open', open);
    burger?.setAttribute('aria-expanded', String(open));
    burger?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu?.setAttribute('aria-hidden', String(!open));
  };
  burger?.addEventListener('click', () => setMenu(!html.classList.contains('menu-open')));
  addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

  /* ── anchor links ───────────────────────────────────────────── */
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const el = a.hash && a.hash.length > 1 ? $(a.hash) : null;
    e.preventDefault();
    setMenu(false);
    if (!el) { scrollToY(0); return; }
    scrollToY(a.hash === '#top' ? 0 : el.getBoundingClientRect().top + scrollY);
  });

  /* ── clock + year ───────────────────────────────────────────── */
  {
    const clock = $('[data-clock]');
    const tick = () => { if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
    tick(); setInterval(tick, 30_000);
    const y = $('[data-year]');
    if (y) y.textContent = new Date().getFullYear();
  }
})();

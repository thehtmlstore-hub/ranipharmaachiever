/* =========================================================
   RANI PHARMA ACHIEVERS — front-end interactions
   No frameworks. Small, independent modules:
   1. Mobile nav toggle
   2. FAQ accordion
   3. Toppers data → DOM render (structured for future LMS binding)
   4. Enquiry form (validation + WhatsApp hand-off)
   5. Scroll reveal (staggered, respects reduced-motion)
   6. Topper photo slideshow (autoplay, dots, swipe, arrow keys)
   7. Rolling reviews marquee (+ pause button)
   8. Misc: auto year
   9. Nav state: shadow, back-to-top, scrollspy
   10. Count-up numbers
   11. Copy buttons + toast
   12. Card spotlight
   13. Topper lightbox
   ========================================================= */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Runs fn once the preloader has gone (immediately if it already has)
function whenReady(fn) {
  if (window.__rpaReady || !document.getElementById('preloader')) fn();
  else window.addEventListener('rpa:ready', fn, { once: true });
}

/* ---------- 1. MOBILE NAV TOGGLE ----------
   Animated open/close; closes on a link tap, Escape, or a tap
   outside the menu. */
(function() {
  const toggle = document.getElementById('navToggle');
  const menu = document.getElementById('mobileMenu');
  if (!toggle || !menu) return;
  function setOpen(open) {
    menu.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  toggle.addEventListener('click', () => setOpen(!menu.classList.contains('is-open')));
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', e => {
    if (menu.classList.contains('is-open') && !menu.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
})();

/* ---------- 2. FAQ ACCORDION ----------
   One answer open at a time; answers slide open (CSS section 14). */
(function() {
  const items = document.querySelectorAll('.faq__item');
  items.forEach((item, n) => {
    const btn = item.querySelector('.faq__question');
    const answer = item.querySelector('.faq__answer');
    answer.id = answer.id || `faq-answer-${n + 1}`;
    btn.setAttribute('aria-controls', answer.id);
    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open');
      items.forEach(i => {
        i.classList.remove('is-open');
        i.querySelector('.faq__question').setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        item.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
})();

/* ---------- 3. TOPPERS DATA → RENDER ----------
   ----------------------------------------------------
   Two groups, each rendered into its own grid:
     achievers   → #achieversGrid   (GPAT — All India Rank, "AIR")
     rankHolders → #rankHoldersGrid (Tamil Nadu M.Pharm entrance —
                                     general + community rank)

   Each topper: { name, photo, ranks: [{ label, value }] }
   Cards are sorted by their first rank (lowest = best), so
   the 1 / 2 / 3 medal badges always follow the numbers.

   FUTURE LMS INTEGRATION:
   Replace the static arrays below with a fetch() to your
   results endpoint returning the same shape, e.g.
     fetch('/api/lms/batch-toppers')
       .then(r => r.json())
       .then(data => renderToppers('achieversGrid', data));
   ---------------------------------------------------- */
const achievers = [
  {
    name: "Veeravel T",
    photo: "images/toppers/veeravel-t.jpg",
    ranks: [{ label: "AIR", value: 1819 }]
  },
  {
    name: "Ashwwin U",
    photo: "images/toppers/ashwwin-u.jpg",
    ranks: [{ label: "AIR", value: 2995 }]
  },
  {
    name: "Dinesh Ram B",
    photo: "images/toppers/dinesh-ram-b.jpg",
    ranks: [{ label: "AIR", value: 2934 }]
  },
  {
    name: "Kuberraja D",
    photo: "images/toppers/kuberraja-d.jpg",
    ranks: [{ label: "AIR", value: 4066 }]
  }
];

const rankHolders = [
  {
    name: "Priyadharshini",
    photo: "images/toppers/priyadharshini.jpg",
    ranks: [{ label: "General rank", value: 35 }, { label: "Community rank", value: 19 }]
  },
  {
    name: "Soundherya R",
    photo: "images/toppers/soundherya-r.jpg",
    ranks: [{ label: "General rank", value: 56 }, { label: "Community rank", value: 30 }]
  },
  {
    name: "Menaha S",
    photo: "images/toppers/menaha-s.jpg",
    ranks: [{ label: "General rank", value: 107 }, { label: "Community rank", value: 58 }]
  },
  {
    name: "Sujina J",
    photo: "images/toppers/sujina-j.jpg",
    ranks: [{ label: "General rank", value: 314 }, { label: "Community rank", value: 155 }]
  }
];

function rankClass(rank) {
  if (rank === 1) return 'achiever-card__rank--1';
  if (rank === 2) return 'achiever-card__rank--2';
  if (rank === 3) return 'achiever-card__rank--3';
  return '';
}

function formatRank(n) {
  return Number(n).toLocaleString('en-IN');
}

function rankText(t) {
  return t.ranks.map(r => `${r.label} ${formatRank(r.value)}`).join(', ');
}

function byRank(data) {
  return [...data].sort((a, b) => a.ranks[0].value - b.ranks[0].value);
}

function renderToppers(gridId, data) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = byRank(data).map((t, i) => `
    <article class="achiever-card">
      <div class="achiever-card__media">
        <img class="achiever-card__photo" src="${t.photo}" alt="${t.name}, ${rankText(t)}" width="560" height="700" loading="lazy" />
        <span class="achiever-card__rank ${rankClass(i + 1)}" aria-label="Position ${i + 1}">${i + 1}</span>
        <span class="achiever-card__expand" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></span>
      </div>
      <div class="achiever-card__body">
        <h4 class="achiever-card__name">${t.name}</h4>
        <div class="achiever-card__ranks${t.ranks.length > 1 ? ' achiever-card__ranks--2' : ''}">
          ${t.ranks.map(r => `
            <div class="achiever-card__score">
              <span class="achiever-card__score-num" data-count="${r.value}">${formatRank(r.value)}</span>
              <span class="achiever-card__score-label">${r.label}</span>
            </div>`).join('')}
        </div>
      </div>
      <button class="achiever-card__open" type="button" data-open-topper="${t.name}" aria-label="View ${t.name} — photo and ranks"></button>
    </article>
  `).join('');
}

renderToppers('achieversGrid', achievers);
renderToppers('rankHoldersGrid', rankHolders);

/* Hero on page one — slideshow (one slide per topper, same order
   as the Results section), its dots, and the avatar row. Built here
   so the slideshow module (section 6) finds everything in place. */
function renderHero(groups) {
  const frame = document.getElementById('heroSlides');
  const dotsBox = document.getElementById('heroDots');
  if (!frame || !dotsBox) return;
  const toppers = groups.flatMap(byRank);

  frame.innerHTML = toppers.map((t, i) => `
    <figure class="slideshow__slide${i === 0 ? ' is-active' : ''}" data-topper="${t.name}">
      <img src="${t.photo}" alt="${t.name}, ${rankText(t)}" width="560" height="700" />
      <figcaption class="hero__caption">
        <span class="hero__caption-name">${t.name}</span>
        <span class="hero__caption-ranks">${t.ranks.map(r => `
          <span class="hero__caption-rank">
            <span class="hero__caption-num">${formatRank(r.value)}</span>
            <span class="hero__caption-label">${r.label.replace(/\s*rank$/i, '') || r.label}</span>
          </span>`).join('')}
        </span>
      </figcaption>
    </figure>`).join('') +
    `<button class="hero__zoom" type="button" data-open-topper aria-label="View this topper's photo and ranks"></button>`;

  dotsBox.innerHTML = toppers.map((t, i) => `
      <button class="slideshow__dot${i === 0 ? ' is-active' : ''}" type="button" aria-label="Show ${t.name}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('');

  const avatars = document.getElementById('heroAvatars');
  if (avatars) {
    const shown = toppers.slice(0, 5);
    const extra = toppers.length - shown.length;
    avatars.innerHTML = shown.map(t => `<img src="${t.photo}" alt="" width="40" height="40" />`).join('')
      + (extra > 0 ? `<span class="hero__avatars-more">+${extra}</span>` : '');
  }
  document.querySelectorAll('[data-topper-count]').forEach(el => { el.textContent = toppers.length; });
}

renderHero([achievers, rankHolders]);

/* All toppers in display order (achievers first) — for the lightbox */
const allToppers = [
  ...byRank(achievers).map(t => ({ ...t, group: 'GPAT Achiever' })),
  ...byRank(rankHolders).map(t => ({ ...t, group: 'Tamil Nadu M.Pharm Entrance Exam' }))
];

/* Reviews by toppers — any review author tagged data-topper="<name>"
   gets that topper's photo and name from the data above (the role
   line is kept as written in the review).
   Runs before the reviews marquee (section 7) duplicates the cards. */
(function() {
  const toppers = [...achievers, ...rankHolders];
  document.querySelectorAll('.testimonial__author[data-topper]').forEach(el => {
    const t = toppers.find(x => x.name === el.dataset.topper);
    if (!t) return;
    el.querySelector('.testimonial__avatar').src = t.photo;
    el.querySelector('.testimonial__name').textContent = t.name;
  });
})();

/* ---------- 4. ENQUIRY FORM ----------
   Errors show only after a field is used (:user-invalid) or on a
   submit attempt (.was-validated), with aria-invalid kept in sync.
   A valid enquiry opens WhatsApp with the details pre-filled, ready
   to send to the institute. Links with data-interest (e.g. "Book a
   free demo class") pre-select the topic. */
(function() {
  const form = document.getElementById('enquiryForm');
  if (!form) return;
  const WHATSAPP_NUMBER = '918220028504';
  const $ = id => document.getElementById(id);
  const fields = form.querySelectorAll('.form__input, .form__select, .form__textarea');
  const phone = $('f-phone');
  const topic = $('f-batch');
  const msg = $('f-msg');
  const counter = $('f-msg-count');
  const success = $('formSuccess');

  function syncAria(el) {
    const invalid = el.matches(':user-invalid') ||
      (form.classList.contains('was-validated') && !el.checkValidity());
    if (invalid) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  }
  fields.forEach(el => {
    el.addEventListener('blur', () => syncAria(el));
    el.addEventListener('change', () => syncAria(el));
    el.addEventListener('input', () => { if (el.hasAttribute('aria-invalid')) syncAria(el); });
  });

  // Phone: digits only; a pasted +91 or leading 0 is dropped
  phone.addEventListener('input', () => {
    let d = phone.value.replace(/\D/g, '');
    if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
    if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
    phone.value = d.slice(0, 10);
  });

  const updateCount = () => { counter.textContent = `${msg.value.length} / ${msg.maxLength}`; };
  msg.addEventListener('input', updateCount);

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      fields.forEach(syncAria);
      form.querySelector(':invalid').focus();
      return;
    }
    const lines = [
      'Hello Rani Pharma Achievers! Please call me back.',
      '',
      `Student name: ${$('f-name').value.trim()}`,
      `Phone: ${phone.value}`
    ];
    if ($('f-email').value.trim()) lines.push(`Email: ${$('f-email').value.trim()}`);
    lines.push(`Interested in: ${topic.options[topic.selectedIndex].text}`);
    if (msg.value.trim()) lines.push(`Message: ${msg.value.trim()}`);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');

    form.reset();
    form.classList.remove('was-validated');
    fields.forEach(el => el.removeAttribute('aria-invalid'));
    updateCount();
    success.hidden = false;
    setTimeout(() => {
      success.textContent = "✓ WhatsApp opened with your details — just tap send. We'll call you back within 24 hours.";
    }, 50);
    setTimeout(() => { success.hidden = true; }, 12000);
  });

  document.addEventListener('click', e => {
    const link = e.target.closest('a[data-interest]');
    if (!link) return;
    topic.value = link.dataset.interest;
    syncAria(topic);
    form.classList.remove('is-highlight');
    void form.offsetWidth;  // restart the highlight animation
    form.classList.add('is-highlight');
    if (window.matchMedia('(pointer: fine)').matches) $('f-name').focus({ preventScroll: true });
  });
})();

/* ---------- 5. SCROLL REVEAL ---------- */
(function() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach(el => {
    // Cards in the same grid fade in one after another
    const group = [...el.parentElement.children].filter(c => c.classList.contains('reveal'));
    const i = group.indexOf(el);
    if (i > 0) {
      el.style.transitionDelay = `${(i % 4) * 80}ms`;
      el.addEventListener('transitionend', () => { el.style.transitionDelay = ''; }, { once: true });
    }
    io.observe(el);
  });
})();

/* ---------- 6. TOPPER PHOTO SLIDESHOW ----------
   Auto-advancing crossfade slideshow. Autoplay pauses on hover/focus,
   can be stopped with the pause button, and starts paused for
   prefers-reduced-motion users (they can still press play or use
   the dots). */
(function() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-slideshow]').forEach(root => {
    const slides = root.querySelectorAll('.slideshow__slide');
    const dots = root.querySelectorAll('.slideshow__dot');
    const pauseBtn = root.querySelector('.slideshow__pause');
    if (slides.length < 2) return;
    let idx = 0;
    let timer = null;
    let paused = reduced;
    function show(i) {
      idx = (i + slides.length) % slides.length;
      slides.forEach((s, n) => s.classList.toggle('is-active', n === idx));
      dots.forEach((d, n) => {
        d.classList.toggle('is-active', n === idx);
        if (n === idx) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
      });
    }
    function start() {
      if (paused || timer) return;
      timer = setInterval(() => show(idx + 1), Number(root.dataset.interval) || 4500);
    }
    function stop() {
      clearInterval(timer);
      timer = null;
    }
    dots.forEach((dot, n) => {
      dot.addEventListener('click', () => { show(n); stop(); start(); });
    });
    if (pauseBtn) {
      pauseBtn.setAttribute('aria-pressed', String(paused));
      pauseBtn.addEventListener('click', () => {
        paused = !paused;
        pauseBtn.setAttribute('aria-pressed', String(paused));
        if (paused) stop(); else start();
      });
    }
    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);
    root.addEventListener('focusin', stop);
    root.addEventListener('focusout', start);

    // Swipe (touch or mouse drag) and arrow keys move between slides;
    // a swipe doesn't count as a click on the photo
    let x0 = null, y0 = 0, swiped = false;
    root.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; swiped = false; });
    root.addEventListener('pointercancel', () => { x0 = null; });
    root.addEventListener('pointerup', e => {
      if (x0 === null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        swiped = true;
        show(idx + (dx < 0 ? 1 : -1));
      }
    });
    root.addEventListener('click', e => {
      if (swiped) { e.stopPropagation(); e.preventDefault(); swiped = false; }
    }, true);
    root.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      show(idx + (e.key === 'ArrowRight' ? 1 : -1));
    });

    show(0);
    start();
  });
})();

/* ---------- 7. ROLLING REVIEWS MARQUEE ----------
   Clones the review cards once so the CSS track loops seamlessly
   (translateX -50%); clones are hidden from screen readers. Hover or
   the pause button stops the roll. Reduced motion: no roll and no
   clones — the row scrolls sideways instead (CSS section 20). */
(function() {
  document.querySelectorAll('[data-marquee]').forEach(marquee => {
    const track = marquee.querySelector('.marquee__track');
    if (!prefersReducedMotion) {
      [...track.children].forEach(card => {
        const clone = card.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      });
    }
    const btn = marquee.parentElement.querySelector('.marquee__toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const paused = marquee.classList.toggle('is-paused');
      btn.setAttribute('aria-pressed', String(paused));
      btn.querySelector('.marquee__label').textContent = paused ? 'Play reviews' : 'Pause reviews';
    });
  });
})();

/* ---------- 8. MISC: AUTO YEAR ---------- */
document.getElementById('year').textContent = new Date().getFullYear();

/* ---------- 9. NAV STATE: SHADOW, BACK-TO-TOP, SCROLLSPY ----------
   Native scrollspy (scroll-target-group + :target-current) where
   supported; elsewhere a light scroll check adds the same state as
   a class. aria-current mirrors the highlight either way. */
(function() {
  const nav = document.querySelector('.nav');
  const toTop = document.querySelector('.to-top');
  const links = [...document.querySelectorAll('.nav__links a, .mobile-menu a')];
  const native = CSS.supports('scroll-target-group: auto');
  const targets = [...new Set(links.map(a => a.getAttribute('href')))]
    .map(href => document.querySelector(href))
    .filter(Boolean);

  function syncAria() {
    links.forEach(a => {
      const on = native ? a.matches(':target-current') : a.classList.contains(':target-current');
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }
  function fallbackSpy() {
    const line = window.innerHeight * 0.35;
    let current = null;
    targets.forEach(t => { if (t.getBoundingClientRect().top <= line) current = t; });
    const href = current ? '#' + current.id : null;
    links.forEach(a => a.classList.toggle(':target-current', a.getAttribute('href') === href));
    syncAria();
  }

  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle('is-scrolled', y > 8);
    if (toTop) toTop.classList.toggle('is-visible', y > window.innerHeight);
    if (native) syncAria(); else fallbackSpy();
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (native) {
    syncAria();
    document.addEventListener('scrollend', syncAria);
  }
})();

/* ---------- 10. COUNT-UP NUMBERS ----------
   Hero stats and topper ranks count up the first time they scroll
   into view (after the preloader). Reduced motion: shown as-is. */
(function() {
  const els = document.querySelectorAll('[data-count]');
  if (!els.length || prefersReducedMotion || !('IntersectionObserver' in window)) return;
  const fmt = (el, n) => Number(n).toLocaleString('en-IN') + (el.dataset.suffix || '');
  function run(el) {
    const target = Number(el.dataset.count);
    const t0 = performance.now();
    const duration = 1400;
    (function tick(now) {
      const p = Math.min(1, (now - t0) / duration);
      el.textContent = fmt(el, Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      run(entry.target);
    });
  }, { threshold: 0.6 });
  whenReady(() => els.forEach(el => {
    el.textContent = fmt(el, 0);
    io.observe(el);
  }));
})();

/* ---------- 11. COPY BUTTONS + TOAST ---------- */
const showToast = (function() {
  const el = document.getElementById('toast');
  let timer;
  return message => {
    if (!el) return;
    el.classList.add('is-visible');
    el.textContent = message;
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('is-visible'), 2200);
  };
})();
(function() {
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fallback for pages opened from a file or older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await copy(btn.dataset.copy);
      showToast(ok ? `Copied ${btn.dataset.copy}` : "Couldn't copy — please select it manually");
      if (!ok) return;
      btn.classList.add('is-done');
      setTimeout(() => btn.classList.remove('is-done'), 1500);
    });
  });
})();

/* ---------- 12. CARD SPOTLIGHT (mouse / trackpad only) ---------- */
(function() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const cards = '.why__card, .audience-card, .subject-card, .process__step, .batch-card, .testimonial, .included__panel';
  document.addEventListener('pointermove', e => {
    const card = e.target.closest(cards);
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
})();

/* ---------- 13. TOPPER LIGHTBOX ----------
   Any [data-open-topper] (topper cards, the hero photo) opens a
   modal <dialog> with the large photo and ranks. Prev / next via
   buttons, arrow keys or swipe; Esc or a backdrop click closes it
   (closedby="any", with a click fallback for Safari). */
(function() {
  const dialog = document.getElementById('topperDialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const photo = document.getElementById('lightboxPhoto');
  const nameEl = document.getElementById('lightboxName');
  const groupEl = document.getElementById('lightboxGroup');
  const ranksEl = document.getElementById('lightboxRanks');
  const countEl = document.getElementById('lightboxCount');
  let idx = 0;

  function render(i) {
    idx = (i + allToppers.length) % allToppers.length;
    const t = allToppers[idx];
    photo.src = t.photo;
    photo.alt = `${t.name}, ${rankText(t)}`;
    nameEl.textContent = t.name;
    groupEl.textContent = t.group;
    ranksEl.innerHTML = t.ranks.map(r => `
      <div class="lightbox__rank">
        <span class="lightbox__rank-num">${formatRank(r.value)}</span>
        <span class="lightbox__rank-label">${r.label}</span>
      </div>`).join('');
    countEl.textContent = `${idx + 1} / ${allToppers.length}`;
  }

  document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-open-topper]');
    if (!trigger) return;
    let name = trigger.dataset.openTopper;
    if (!name) {
      const active = trigger.closest('.hero__frame')?.querySelector('.slideshow__slide.is-active');
      name = active ? active.dataset.topper : '';
    }
    const i = allToppers.findIndex(t => t.name === name);
    render(i < 0 ? 0 : i);
    dialog.showModal();
  });

  dialog.querySelector('.lightbox__close').addEventListener('click', () => dialog.close());
  dialog.querySelectorAll('[data-step]').forEach(btn => {
    btn.addEventListener('click', () => render(idx + Number(btn.dataset.step)));
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') render(idx + 1);
    if (e.key === 'ArrowLeft') render(idx - 1);
  });

  // Swipe on the photo
  const media = dialog.querySelector('.lightbox__media');
  let x0 = null;
  media.addEventListener('pointerdown', e => { x0 = e.clientX; });
  media.addEventListener('pointercancel', () => { x0 = null; });
  media.addEventListener('pointerup', e => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) render(idx + (dx < 0 ? 1 : -1));
  });

  // Light-dismiss fallback for browsers without closedby (Safari)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', e => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) dialog.close();
    });
  }
})();

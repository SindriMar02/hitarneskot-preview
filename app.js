/* Hítarneskot · White Desert engine, re-aimed from the Eyvindarholt build (Kleif v1 transplant)
   Vanilla + GSAP ScrollTrigger + Lenis (DESKTOP ONLY — Lenis never mounts on a
   touch device: it breaks iOS chrome and fights the compositor). One writer
   per element. Mobile chrome: constant glass bar + sticky awning, zero motion. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  var isDesktop = function () { return window.matchMedia('(min-width: 769px)').matches; };
  var body = document.body;

  /* ---------- nav theme swap (works with or without motion) ---------- */
  function setNavTheme(v) {
    body.setAttribute('data-nav-theme', v === 'dark' ? 'dark' : 'light');
    var meta = document.getElementById('themeColor');
    if (meta) meta.setAttribute('content', v === 'dark' ? '#FFFFFF' : '#0B0C0D');
  }

  /* ---------- scroll lock: Lenis on desktop, fixed-body on touch ----------
     overflow:hidden alone would turn body into a scroll container and kill
     the sticky awning, so the lock is position:fixed at -scrollY. */
  var lenis = null;
  var lockY = 0, locked = false;
  function lockScroll() {
    if (locked) return; locked = true;
    if (lenis) { lenis.stop(); return; }
    lockY = window.scrollY;
    body.style.position = 'fixed';
    body.style.top = -lockY + 'px';
    body.style.left = '0'; body.style.right = '0'; body.style.width = '100%';
  }
  function unlockScroll() {
    if (!locked) return; locked = false;
    if (lenis) { lenis.start(); return; }
    body.style.position = ''; body.style.top = '';
    body.style.left = ''; body.style.right = ''; body.style.width = '';
    window.scrollTo(0, lockY);
  }

  /* ---------- flyout (no motion dependency) ---------- */
  var flyout = document.getElementById('flyout');
  var flyoutTab = document.getElementById('flyoutTab');
  var flyoutClose = document.getElementById('flyoutClose');
  var flyoutOverlay = document.getElementById('flyoutOverlay');
  function openFlyout() {
    flyout.classList.add('is-open');
    flyout.setAttribute('aria-hidden', 'false');
    flyoutTab.setAttribute('aria-expanded', 'true');
    body.classList.add('hide-grid');
    lockScroll();
    setTimeout(function () { flyoutClose.focus({ preventScroll: true }); }, 480);
  }
  function closeFlyout() {
    flyout.classList.remove('is-open');
    flyout.setAttribute('aria-hidden', 'true');
    flyoutTab.setAttribute('aria-expanded', 'false');
    body.classList.remove('hide-grid');
    unlockScroll();
    if (isDesktop()) flyoutTab.focus();
  }
  flyoutTab.addEventListener('click', openFlyout);
  flyoutClose.addEventListener('click', closeFlyout);
  flyoutOverlay.addEventListener('click', closeFlyout);

  /* ---------- mobile menu (burger -> full panel under the constant bar) ---------- */
  var menuBtn = document.getElementById('menuBtn');
  var menuPanel = document.getElementById('menuPanel');
  var menuOpen = false;
  function openMenu() {
    menuOpen = true;
    menuPanel.classList.add('is-open');
    menuPanel.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
    body.classList.add('hide-grid');
    body.classList.add('menu-open');
    lockScroll();
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    menuPanel.classList.remove('is-open');
    menuPanel.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    body.classList.remove('hide-grid');
    body.classList.remove('menu-open');
    unlockScroll();
  }
  if (menuBtn && menuPanel) {
    menuBtn.addEventListener('click', function () { menuOpen ? closeMenu() : openMenu(); });
    /* close BEFORE the default anchor jump: unlock restores the old scroll
       position synchronously, then the browser jumps to the target */
    menuPanel.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { closeMenu(); });
    });
    var menuFlyoutBtn = document.getElementById('menuFlyoutBtn');
    if (menuFlyoutBtn) menuFlyoutBtn.addEventListener('click', function () { closeMenu(); openFlyout(); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (flyout.classList.contains('is-open')) closeFlyout();
    else if (menuOpen) closeMenu();
  });

  /* ---------- booking form: request-to-book through the SNDR engine ----------
     POSTs to the platform's public /booking/request for the hitarneskot tenant.
     REQUEST mode: the record lands PENDING on the host's desk (/owner), no
     card and no charge. The engine is the gate: conflicts, lead time and
     capacity come back as reasons and are shown, never papered over. */
  var form = document.getElementById('bookForm');
  if (form) {
    /* hitarneskot.localhost resolves to 127.0.0.1 in every browser; the tenant is
       keyed to that host. Overridable for a deployed preview. */
    /* Only ever talk to the engine from a local run. A public preview that fetches
       `localhost` shows the owner a failed request in the console and, in newer
       Chrome, a local-network permission prompt, so off localhost the picker simply
       shows every night open and the form says the desk is not switched on here. */
    var LOCAL = /^(localhost|127\.0\.0\.1|hitarneskot\.localhost)$/.test(location.hostname);
    var API = window.HIT_API || (LOCAL ? 'http://hitarneskot.localhost:8787' : '');
    /* The engine books by TYPE: the two Lake Houses are one `lake-house` type, so a
       night is open while either is free and the guest is placed in the first free
       one. A riders' group is an Ocean House request with the group flagged in the
       note (the hosts read it; the engine only sees ten people in one house). */
    var TYPE_IDS = { ocean: 'ocean-house', lake: 'lake-house', riders: 'ocean-house' };
    var $ = function (id) { return document.getElementById(id); };
    var errFor = { bkGuests: 'errGuests', bkName: 'errName', bkPhone: 'errPhone', bkEmail: 'errEmail' };
    Object.keys(errFor).forEach(function (id) {
      $(id).addEventListener('input', function () {
        $(errFor[id]).hidden = true;
        $('errForm').hidden = true;
      });
    });
    /* ---------- THE STAY PICKER ----------
       Rules ported from the engine-wired picker (03-prototypes/riverbank
       StayPicker.tsx), which came from the audited aurora-hills one:
         1. past nights blocked; booked nights struck and still readable;
         2. a range may not CROSS a booked night, and the refusal restarts the
            stay at the clicked day with the reason said out loud;
         3. a booked night is still a legal CHECKOUT, so the crossing test runs
            over [start, end-1], never [start, end];
         4. the minimum stay is enforced at selection, naming the earliest checkout;
         5. hover previews the range while the checkout is being chosen;
         6. UNDO (Sindri, 2026-09-15): tapping the chosen check-in clears the
            stay, tapping the chosen checkout clears only the checkout, and a
            visible Clear dates control appears once any date is chosen.
       Availability is the engine's own GET /booking/days. When it does not
       answer (this preview has no live tenant) no night is invented as booked. */
    var stay = (function () {
      var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      var MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      /* two nights is the tenant's minimum (a guess until the hosts confirm it) */
      var MIN_STAY = 2;
      var DAY = 86400000;
      var sod = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
      var add = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
      var addMo = function (d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); };
      var nights = function (a, b) { return Math.round((b - a) / DAY); };
      var key = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      var same = function (a, b) { return !!a && !!b && key(a) === key(b); };
      var fmt = function (d) { return d.getDate() + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear(); };
      var fmtShort = function (d) { return WD[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MO[d.getMonth()].slice(0, 3); };

      var today = sod(new Date());
      var left = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
      var firstMonth = new Date(today.getFullYear(), today.getMonth() + (left < 7 ? 1 : 0), 1);
      var month = firstMonth;
      var start = null, end = null, hover = null, free = null, fetchSeq = 0, curType = 'ocean-house', curPeople = 1;
      var grids = $('stayGrids');

      function taken(d) { return free ? !free.has(key(d)) : false; }
      function crosses(a, b) { for (var d = a; d < b; d = add(d, 1)) if (taken(d)) return true; return false; }
      function note(text) { var n = $('stayNote'); n.textContent = text || ''; n.hidden = !text; }

      function monthHTML(m, idx) {
        var first = new Date(m.getFullYear(), m.getMonth(), 1);
        var lead = (first.getDay() + 6) % 7;
        var previewTo = end || (start && hover && hover > start ? hover : null);
        var h = '<div class="stay_m' + (idx ? ' stay_m2' : '') + '">' +
          '<p class="stay_cap">' + MO[m.getMonth()] + ' ' + m.getFullYear() + '</p>' +
          '<div class="stay_wd" aria-hidden="true">' + WD.map(function (w) { return '<span>' + w.slice(0, 2) + '</span>'; }).join('') + '</div>' +
          '<div class="stay_g' + (end ? ' has-range' : '') + '">';
        for (var i = 0; i < 42; i++) {
          var d = add(first, i - lead);
          var inMonth = d.getMonth() === m.getMonth();
          if (!inMonth) { h += '<span class="stay_d is-blank" aria-hidden="true"></span>'; continue; }
          var past = d < today, tk = !past && taken(d);
          var cls = ['stay_d'];
          if (past) cls.push('is-past');
          if (tk) cls.push('is-taken');
          if (same(d, start)) cls.push('is-start');
          if (same(d, end)) cls.push('is-end');
          if (start && previewTo && d > start && d < previewTo) cls.push('is-in');
          if (same(d, previewTo) && !end) cls.push('is-preview');
          var label = fmt(d) + (tk ? ', booked' : '') + (same(d, start) ? ', arrival' : '') + (same(d, end) ? ', departure' : '');
          h += '<button type="button" class="' + cls.join(' ') + '" data-day="' + key(d) + '"' +
            (past ? ' disabled' : '') + (same(d, start) || same(d, end) ? ' aria-pressed="true"' : '') +
            ' aria-label="' + label + '">' + d.getDate() + '</button>';
        }
        return h + '</div></div>';
      }

      function render() {
        grids.innerHTML = monthHTML(month, 0) + monthHTML(addMo(month, 1), 1);
        $('stayLive').textContent = MO[month.getMonth()] + ' ' + month.getFullYear();
        $('stayPrev').disabled = month <= firstMonth && month <= new Date(today.getFullYear(), today.getMonth(), 1);
        $('stayIn').textContent = start ? fmtShort(start) : 'Pick a night';
        $('stayOut').textContent = end ? fmtShort(end) : (start ? 'Now the morning you leave' : 'Pick a morning');
        var n = start && end ? nights(start, end) : 0;
        $('stayNights').textContent = n ? n + (n === 1 ? ' night' : ' nights') + ', booked direct with no platform fee' : 'Minimum ' + MIN_STAY + ' nights';
        $('stayClear').hidden = !start;
        $('bkArrive').value = start ? key(start) : '';
        $('bkDepart').value = start && end ? key(end) : '';
        if (start && end) { $('errArrive').hidden = true; $('errForm').hidden = true; }
      }

      function clear(keepStart) {
        if (!keepStart) start = null;
        end = null; hover = null; note(''); render();
      }

      function pick(d) {
        if (d < today) return;
        if (start && same(d, start)) { clear(false); return; }
        if (end && same(d, end)) { clear(true); return; }
        if (taken(d) && (!start || end)) { note(fmt(d) + ' is already booked. The struck-through nights are taken.'); return; }
        if (!start || end || d <= start) { start = d; end = null; note(''); render(); return; }
        if (crosses(start, d)) {
          start = d; end = null;
          note('A booked night sits between those dates, so this is a new arrival on ' + fmt(d) + '. Pick the morning you leave.');
          render(); return;
        }
        if (nights(start, d) < MIN_STAY) { note('The minimum stay is ' + MIN_STAY + ' nights, so the earliest checkout is ' + fmt(add(start, MIN_STAY)) + '.'); return; }
        end = d; note(''); render();
      }

      grids.addEventListener('click', function (e) {
        var b = e.target.closest('[data-day]'); if (!b || b.disabled) return;
        var p = b.getAttribute('data-day').split('-').map(Number);
        pick(new Date(p[0], p[1] - 1, p[2]));
        var again = grids.querySelector('[data-day="' + b.getAttribute('data-day') + '"]');
        if (again) again.focus({ preventScroll: true });
      });
      /* hover preview is for a real mouse only: a tap fires mouseover too, and on
         a phone that painted a band that looked like a chosen stay */
      var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
      grids.addEventListener('mouseover', function (e) {
        if (!finePointer.matches || !start || end) return;
        var b = e.target.closest('[data-day]'); if (!b) return;
        var p = b.getAttribute('data-day').split('-').map(Number);
        var d = new Date(p[0], p[1] - 1, p[2]);
        if (!same(d, hover)) { hover = d; render(); }
      });
      grids.addEventListener('mouseleave', function () { if (hover) { hover = null; render(); } });
      $('stayPrev').addEventListener('click', function () { month = addMo(month, -1); render(); });
      $('stayNext').addEventListener('click', function () { month = addMo(month, 1); render(); });
      $('stayClear').addEventListener('click', function () { clear(false); $('stayPrev').focus({ preventScroll: true }); });

      /* live nights, refetched when the party size changes: a night free for two
         is not always free for fourteen */
      function load(people, type) {
        if (type) curType = type;
        curPeople = Math.max(1, people || curPeople || 1);
        var seq = ++fetchSeq;
        if (!API) {
          free = null;
          $('staySrc').textContent = 'Design preview: every night shows open. Once the calendars are connected, nights booked on Airbnb or Booking.com or here are struck through automatically.';
          render();
          return;
        }
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 8000);
        var u = API + '/booking/days?from=' + key(today) + '&days=365&people=' + curPeople + '&type=' + encodeURIComponent(curType);
        fetch(u, { signal: ctrl.signal }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (seq !== fetchSeq) return;
            free = data && data.days && data.days.length ? new Set(data.days) : null;
            $('staySrc').textContent = free
              ? 'Live from the booking calendar for this house. Struck-through nights are booked.'
              : 'Design preview: every night shows open. Once the calendars are connected, nights booked on Airbnb or Booking.com or here are struck through automatically.';
            render();
          })
          .catch(function () {
            if (seq !== fetchSeq) return;
            free = null;
            $('staySrc').textContent = 'Design preview: every night shows open. Once the calendars are connected, nights booked on Airbnb or Booking.com or here are struck through automatically.';
            render();
          })
          .finally(function () { clearTimeout(timer); });
      }

      render();
      load(1, 'ocean-house');
      return { reset: function () { clear(false); }, load: load, focus: function () {
        var f = grids.querySelector('button.stay_d:not([disabled])'); if (f) f.focus();
      }, state: function () { return { start: start && key(start), end: end && key(end), live: !!free }; } };
    })();
    window.__stay = stay; /* probe hook for QA */

    /* each house sleeps what its own listing says (Ocean House 9 on Airbnb and
       Booking.com, 10 for a riders' group per their group page and licence) */
    var SLEEPS = { ocean: 9, lake: 4, riders: 10 };
    function houseKey() {
      var t = (form.querySelector('input[name="house"]:checked') || {}).value || '';
      return /riders/i.test(t) ? 'riders' : /lake/i.test(t) ? 'lake' : 'ocean';
    }
    function syncHouse() {
      var k = houseKey(), max = SLEEPS[k];
      $('bkGuests').max = String(max);
      $('errGuests').textContent = 'How many of you, 1 to ' + max + '?';
      return k;
    }
    form.querySelectorAll('input[name="house"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var k = syncHouse();
        stay.reset();
        stay.load(parseInt($('bkGuests').value, 10) || 1, TYPE_IDS[k]);
      });
    });
    var guestTimer;
    $('bkGuests').addEventListener('input', function () {
      clearTimeout(guestTimer);
      guestTimer = setTimeout(function () { stay.load(parseInt($('bkGuests').value, 10) || 1, TYPE_IDS[houseKey()]); }, 400);
    });
    syncHouse();

    var REASON_TEXT = {
      ALREADY_BOOKED: 'Those nights are already taken there. Try other dates, or another house.',
      OVER_CAPACITY: 'That is more guests than it sleeps. Try the Ocean House, or ask for both Lake Houses in the message.',
      TOO_SOON: 'That arrival is too soon for an online request. Call the hosts instead.',
      TOO_FAR_AHEAD: 'That is further ahead than the calendar is open. Write to the hosts.',
      MIN_NIGHTS: 'That stay is too short to request online.',
      MAX_NIGHTS: 'That stay is longer than can be requested online. Write to the hosts.',
      CLOSED_DAY: 'That house is closed on those dates.',
      OUT_OF_SEASON: 'That house is closed on those dates.',
      INVALID_RANGE: 'Departure must come after arrival.'
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var arrive = $('bkArrive').value, depart = $('bkDepart').value;
      var guests = parseInt($('bkGuests').value, 10);
      var name = $('bkName').value.trim(), phone = $('bkPhone').value.trim(), email = $('bkEmail').value.trim();
      var msg = $('bkMsg').value.trim();
      var houseInput = form.querySelector('input[name="house"]:checked');
      var hk = houseKey();
      var typeId = TYPE_IDS[hk];
      var bad = [];
      function flag(id, when) { $(errFor[id]).hidden = !when; if (when) bad.push($(id)); }
      var datesBad = !arrive || !depart || depart <= arrive;
      $('errArrive').hidden = !datesBad;
      flag('bkGuests', !(guests >= 1 && guests <= SLEEPS[hk]));
      flag('bkName', !name);
      flag('bkPhone', !phone);
      flag('bkEmail', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      var errForm = $('errForm');
      if (datesBad || bad.length) {
        errForm.textContent = 'Check the highlighted fields, then send again.';
        errForm.hidden = false;
        if (datesBad) stay.focus(); else bad[0].focus();
        return;
      }
      errForm.hidden = true;

      var submitBtn = $('bkSubmit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      function fail(text) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send the request';
        errForm.textContent = text;
        errForm.hidden = false;
      }

      if (!API) {
        fail('Online requests are not switched on in this design preview. Call +354 665 6366 or write to hitarnesfjorur@gmail.com.');
        return;
      }
      fetch(API + '/booking/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typeId: typeId,
          date: arrive,
          endDate: depart,
          people: guests,
          customer: { name: name, phone: phone, email: email },
          note: (hk === 'riders' ? 'RIDERS GROUP REQUEST (Ocean House, horses). ' : '') + (msg || '')
        })
      }).then(function (res) {
        return res.json().then(function (data) { return { status: res.status, data: data }; });
      }).then(function (r) {
        window.__bookResult = r; /* probe hook for QA */
        if (r.data && r.data.ok) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send the request';
          form.hidden = true;
          var done = $('bookDone');
          $('bookRef').textContent = r.data.id || '';
          done.hidden = false;
          done.focus && done.focus();
          return;
        }
        if (r.status === 409 && r.data.reasons && r.data.reasons.length) {
          var known = r.data.reasons.map(function (x) { return REASON_TEXT[x]; }).filter(Boolean);
          fail(known[0] || 'Those dates cannot be requested online. Call or write to the hosts.');
          return;
        }
        if (r.status === 503 && r.data.reason === 'paused') {
          fail('Online requests are paused right now. Call +354 665 6366 or write to hitarnesfjorur@gmail.com.');
          return;
        }
        if (r.data && r.data.messages && r.data.messages.length) {
          fail(r.data.messages[0]);
          return;
        }
        fail('The request did not go through. Call +354 665 6366 or write to hitarnesfjorur@gmail.com.');
      }).catch(function () {
        fail(/github\.io$/.test(location.hostname)
          ? 'Online requests are not switched on in this design preview. Call +354 665 6366 or write to hitarnesfjorur@gmail.com.'
          : 'The booking desk cannot be reached right now. Call +354 665 6366 or write to hitarnesfjorur@gmail.com.');
      });
    });
  }

  /* ---------- reduced motion: static render, theme swap via observer ---------- */
  if (reduced || !window.gsap) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) setNavTheme(en.target.getAttribute('data-nav-theme-val'));
      });
    }, { rootMargin: '-45% 0% -45% 0%' });
    document.querySelectorAll('[data-nav-section]').forEach(function (s) { io.observe(s); });
    document.querySelectorAll('.text-scroll-fade').forEach(function (el) {
      el.style.webkitMaskImage = 'none'; el.style.maskImage = 'none';
    });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  /* iOS collapses its URL bar the moment a scroll starts, which fires resize.
     A refresh mid-fling re-lays-out every trigger and writes scroll, and WebKit
     answers a scroll write by KILLING the momentum dead - the "abrupt stop".
     So height-only resizes on touch must never reach ScrollTrigger. */
  ScrollTrigger.config({ ignoreMobileResize: true });

  /* ---------- Lenis: DESKTOP ONLY, on the GSAP ticker ----------
     On touch, native scrolling drives ScrollTrigger directly. */
  if (!isTouch) {
    lenis = new Lenis({ lerp: 0.1, autoRaf: false });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
  }
  gsap.ticker.lagSmoothing(0);

  var vh = function () { return window.innerHeight; };
  /* iOS delivers scroll events async with rendering, so a synchronous scrub
     visibly steps. A small lerp on touch rides the ticker instead; desktop
     keeps true - Lenis already smooths the event flow there. */
  var SCRUB = isTouch ? 0.35 : true;

  /* ---------- intro wipe: time-based, never load-bearing ---------- */
  var wipe = document.getElementById('introWipe');
  gsap.set(wipe, { clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' });
  gsap.to(wipe, {
    clipPath: 'polygon(0 0, 100% 0, 100% 0%, 0 0%)',
    duration: 0.8, delay: 0.15, ease: 'power4.inOut',
    onComplete: function () { wipe.classList.add('is-done'); }
  });

  /* ---------- nav hide: desktop only (mobile bar is constant, never moves) ---------- */
  if (lenis) {
    var nav = document.getElementById('nav');
    var navTl = gsap.timeline({ paused: true });
    navTl.to(nav, { yPercent: -100, duration: 0.3, ease: 'sine.inOut' }, 0);
    lenis.on('scroll', function (e) {
      if (flyout.classList.contains('is-open') || !isDesktop()) return;
      if (e.scroll > 10 && e.direction === 1) navTl.play();
      else navTl.reverse();
    });
  }

  /* ---------- per-section nav theme ---------- */
  document.querySelectorAll('[data-nav-section]').forEach(function (sec) {
    ScrollTrigger.create({
      trigger: sec, start: 'top 4rem', end: 'bottom 4rem',
      onToggle: function (self) {
        if (self.isActive) setNavTheme(sec.getAttribute('data-nav-theme-val'));
      }
    });
  });

  /* ---------- HERO (not a pin: wrapper rides the scroll) ---------- */
  var hero = document.getElementById('hero');
  var heroWrapper = document.getElementById('heroWrapper');
  var heroContent = document.getElementById('heroContent');
  gsap.to(heroWrapper, {
    y: function () { return vh(); }, ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: SCRUB, invalidateOnRefresh: true, refreshPriority: 10 }
  });
  if (!isTouch) {
    /* a scrubbed Gaussian blur re-renders the whole hero every frame; WebKit
       pays that in paint. The scrim + bg fade carry the dissolve on touch. */
    gsap.fromTo(heroContent, { filter: 'blur(0px)' }, {
      filter: 'blur(10px)', ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: SCRUB, refreshPriority: 10 }
    });
  }
  /* Layers rest at translateY(100%) in CSS and animate the `y` property with a
     UNIT STRING, exactly as the reference does (ledger #97, third variant). */
  hero.querySelectorAll('[data-scroll-speed]').forEach(function (el) {
    var t = el.getAttribute('data-scroll-speed');
    var st = { trigger: hero, start: 'top top', end: 'bottom top', scrub: SCRUB, invalidateOnRefresh: true, refreshPriority: 10 };
    if (t.charAt(0) === '-') gsap.to(el, { y: t, ease: 'none', scrollTrigger: st });
    else gsap.fromTo(el, { y: t }, { y: 0, ease: 'none', scrollTrigger: st });
  });

  /* the hero photo dissolves into paper while the bank crosses it */
  var heroBgFade = document.getElementById('heroBgFade');
  if (heroBgFade) {
    gsap.fromTo(heroBgFade, { opacity: 0 }, {
      opacity: 1, ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top-=8%', end: 'top top-=52%', scrub: SCRUB, refreshPriority: 10 }
    });
  }

  /* mist-transition: the plane stands up out of the page */
  var mistPlane = document.getElementById('mistPlane');
  var mistTransition = document.getElementById('mistTransition');
  if (mistPlane && mistTransition) {
    mistPlane.classList.add('visible');
    gsap.fromTo(mistPlane, { rotateX: 90 }, {
      rotateX: 0, ease: 'none',
      scrollTrigger: { trigger: mistTransition, start: 'top top-=80%', end: 'bottom center', scrub: SCRUB, refreshPriority: 8 }
    });
  }
  /* the reference's -60svh content lift */
  hero.querySelectorAll('[data-hero-drift]').forEach(function (el) {
    gsap.to(el, {
      y: function () { return -0.6 * vh(); }, ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: SCRUB, invalidateOnRefresh: true, refreshPriority: 10 }
    });
  });

  /* ---------- manifesto: mask develop + scribble draw ---------- */
  var maskEl = document.getElementById('maskDevelop');
  gsap.set(maskEl, { '--mask-position': -40 });
  gsap.to(maskEl, {
    '--mask-position': 100, ease: 'none',
    scrollTrigger: { trigger: maskEl, start: 'top 80%', end: 'bottom 60%', scrub: SCRUB, refreshPriority: 9 }
  });
  var scribblePath = document.querySelector('#scribble path');
  if (scribblePath) {
    var len = scribblePath.getTotalLength();
    gsap.set(scribblePath, { strokeDasharray: len, strokeDashoffset: len });
    gsap.to(scribblePath, {
      strokeDashoffset: 0, duration: 1.2, ease: 'power2.inOut',
      scrollTrigger: { trigger: '.manifesto_kicker', start: 'top 75%', toggleActions: 'play none none reverse' }
    });
  }

  /* ---------- inset bands: unclip to full bleed (desktop) ---------- */
  var mm = gsap.matchMedia();
  mm.add('(min-width: 769px)', function () {
    document.querySelectorAll('.has-inset .season_inner').forEach(function (el) {
      gsap.fromTo(el,
        { clipPath: 'inset(0rem 1.25rem 0rem 1.25rem round 0.375rem)' },
        { clipPath: 'inset(0rem 0rem 0rem 0rem round 0rem)', ease: 'none',
          scrollTrigger: { trigger: el, start: 'top 80%', end: 'top 50%', scrub: SCRUB } });
    });
    ['exhibitFrame', 'ridersFrame'].forEach(function (id) {
      var frame = document.getElementById(id);
      if (!frame) return;
      gsap.fromTo(frame,
        { clipPath: 'inset(0% 0% 18% 0% round 0.375rem)' },
        { clipPath: 'inset(0% 0% 0% 0% round 0.375rem)', ease: 'none',
          scrollTrigger: { trigger: frame, start: 'top 85%', end: 'top 45%', scrub: SCRUB } });
    });
    var plates = document.querySelectorAll('#foodStrip .food_plate');
    plates.forEach(function (el, i) {
      gsap.fromTo(el,
        { clipPath: 'inset(0% 0% 22% 0% round 0.375rem)' },
        { clipPath: 'inset(0% 0% 0% 0% round 0.375rem)', ease: 'none',
          scrollTrigger: { trigger: '#foodStrip', start: 'top 85%', end: 'top ' + (48 - i * 6) + '%', scrub: SCRUB } });
    });
  });

  /* ---------- card-flick: hover accordion (desktop) ---------- */
  mm.add('(min-width: 769px)', function () {
    var flick = document.getElementById('cardFlick');
    var items = Array.prototype.slice.call(flick.querySelectorAll('.card-flick_item'));
    var n = items.length;
    var GROW_ACTIVE = n - 1, GROW_REST = 1;
    var current = 0;
    items.forEach(function (item, i) {
      gsap.set(item, { flexGrow: i === 0 ? GROW_ACTIVE : GROW_REST });
      gsap.set(item.querySelector('.card-flick_content'), { opacity: i === 0 ? 1 : 0 });
    });
    var tl = null;
    function activate(idx) {
      if (idx === current) return;
      current = idx;
      if (tl) tl.kill();
      tl = gsap.timeline();
      items.forEach(function (item, i) {
        var on = i === idx;
        item.classList.toggle('is-active', on);
        tl.to(item, { flexGrow: on ? GROW_ACTIVE : GROW_REST, duration: 0.75, ease: 'expo' }, 0);
        tl.to(item.querySelector('.card-flick_content'), { opacity: on ? 1 : 0, duration: on ? 0.75 : 0.2, ease: on ? 'power1.out' : 'expo.out' }, 0);
      });
    }
    items.forEach(function (item, i) {
      item.addEventListener('mouseenter', function () { activate(i); });
      item.addEventListener('focusin', function () { activate(i); });
    });
    return function () {
      if (tl) tl.kill();
      items.forEach(function (item) {
        gsap.set(item, { clearProps: 'flexGrow,width' });
        gsap.set(item.querySelector('.card-flick_content'), { clearProps: 'opacity' });
      });
    };
  });

  /* ---------- THE RAIL ---------- */
  var railOuter = document.querySelector('.rail_outer');
  var rail = document.getElementById('rail');
  var railContainer = document.getElementById('railContainer');
  var railTitleWrap = document.querySelector('.rail_title-wrap');
  var railTitle = document.getElementById('railTitle');
  var railClipped = document.getElementById('railClipped');
  var railBehind = document.getElementById('railBehind');
  var railOverlay = document.getElementById('railOverlay');
  var curtainRects = Array.prototype.slice.call(document.querySelectorAll('#curtainClip rect'));
  var railTravel = function () { return railContainer.scrollWidth - window.innerWidth; };

  mm.add('(min-width: 769px)', function () {
    gsap.fromTo(railOuter,
      { clipPath: 'inset(0% 10% 0% 10%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', clearProps: 'clipPath',
        scrollTrigger: { trigger: railOuter, start: 'top bottom', end: 'top top', scrub: SCRUB, refreshPriority: 6 } });
  });
  var railType = function () {
    return window.matchMedia('(min-width: 769px)').matches
      ? { enter: '2.4rem', grown: '5.625rem', settled: '3.75rem' }
      : { enter: '1.45rem', grown: '2.2rem', settled: '1.85rem' };
  };
  var railGrow = null;
  function buildRailGrow() {
    if (railGrow) { railGrow.scrollTrigger && railGrow.scrollTrigger.kill(); railGrow.kill(); }
    var t = railType();
    /* animating fontSize reflows the pinned section every frame, so on every
       device the grow is a compositor-only scale, rasterised at the largest
       size so it only ever scales down and stays crisp */
    gsap.set(railTitle, { fontSize: t.grown, transformOrigin: '50% 50%' });
    railGrow = gsap.fromTo(railTitle, { scale: parseFloat(t.enter) / parseFloat(t.grown) }, {
      scale: 1, ease: 'none',
      scrollTrigger: { trigger: railOuter, start: 'top bottom', end: 'top top', scrub: SCRUB, refreshPriority: 6 }
    });
  }
  buildRailGrow();
  gsap.fromTo(railBehind, { yPercent: 18 }, {
    yPercent: 0, ease: 'none',
    scrollTrigger: { trigger: railOuter, start: 'top 60%', end: 'top top', scrub: SCRUB, refreshPriority: 6 }
  });

  /* behind the farm plate sits the hero arrival plate again */
  (function () {
    var valley = document.createElement('div');
    valley.className = 'rail_backdrop';
    valley.style.zIndex = '-1';
    valley.innerHTML = '<img class="img-fill" src="assets/img/plate-hero.webp" alt="" loading="lazy">';
    railBehind.parentNode.insertBefore(valley, railBehind);
  })();

  var railTl = null;
  function buildRail() {
    if (railTl) {
      railTl.scrollTrigger && railTl.scrollTrigger.kill();
      railTl.kill();
      gsap.set([railContainer, railTitleWrap], { clearProps: 'x' });
      gsap.set(railBehind, { clearProps: 'clipPath' });
      gsap.set(railOverlay, { '--rail-overlay': 0 });
      curtainRects.forEach(function (r, i) {
        r.setAttribute('width', '0.3334');
        r.setAttribute('x', String(i * 0.3333));
      });
      gsap.set(railTitle, { clearProps: 'scale,transform' });
    }
    var H = vh();
    var L = railTravel();
    var sText = 1.5 * H;
    var sCurtain = 1 * H;
    var sX = 1.5 * L;
    railTl = gsap.timeline({
      scrollTrigger: {
        trigger: rail, start: 'top top',
        end: '+=' + (sText + sCurtain + sX),
        pin: true, scrub: SCRUB, invalidateOnRefresh: true, refreshPriority: 5
      }
    });
    var rt = railType();
    railTl.fromTo(railTitle, { scale: 1 },
      { scale: parseFloat(rt.settled) / parseFloat(rt.grown), ease: 'none', duration: 0.5 * sText }, 0);
    var tCurtain = 0.5 * sText;
    railTl.to(curtainRects[2], { attr: { width: 0 }, ease: 'none', duration: 0.5 * sCurtain }, tCurtain);
    railTl.to(curtainRects[1], { attr: { width: 0 }, ease: 'none', duration: 0.75 * sCurtain }, tCurtain);
    railTl.to(curtainRects[0], { attr: { width: 0 }, ease: 'none', duration: 1.0 * sCurtain }, tCurtain);
    var tX = tCurtain + 0.3 * sCurtain;
    railTl.to(railContainer, { x: -L, ease: 'none', duration: sX }, tX);
    railTl.to(railTitleWrap, { x: L, ease: 'none', duration: sX }, tX);
    var tWipe = tX + 0.35 * sX;
    railTl.to(railBehind, { clipPath: 'inset(0% 100% 0% 0%)', ease: 'none', duration: 0.45 * sX }, tWipe);
    railTl.to(railOverlay, { '--rail-overlay': 0.4, ease: 'none', duration: 0.45 * sX }, tWipe);
  }
  gsap.set(railOverlay, { '--rail-overlay': 0 });
  buildRail();

  /* ---------- journey thread: route draws down the page, pulse rides it ---------- */
  var flown = document.getElementById('routeFlown');
  var indicator = document.getElementById('routeIndicator');
  var flightWrap = document.getElementById('flightWrap');
  if (flown && indicator) {
    var flownLen = flown.getTotalLength();
    gsap.set(flown, { strokeDasharray: flownLen, strokeDashoffset: flownLen });
    var prog = { p: 0 };
    var vb = { w: 600, h: 1600 };
    gsap.to(prog, {
      p: 1, ease: 'none',
      scrollTrigger: { trigger: flightWrap, start: 'top 65%', end: 'bottom 65%', scrub: SCRUB, invalidateOnRefresh: true, refreshPriority: 3 },
      onUpdate: function () {
        flown.style.strokeDashoffset = String(flownLen * (1 - prog.p));
        var pt = flown.getPointAtLength(flownLen * prog.p);
        indicator.style.left = (pt.x / vb.w * 100) + '%';
        indicator.style.top = (pt.y / vb.h * 100) + '%';
      }
    });
  }

  /* ---------- custom cursor (desktop hover only) ---------- */
  mm.add('(hover: hover) and (pointer: fine)', function () {
    var cur = document.getElementById('cursor');
    var dot = document.getElementById('curDot');
    var lv = document.getElementById('curV');
    var lh = document.getElementById('curH');
    var label = document.getElementById('curLabel');
    gsap.set(cur, { xPercent: -50, yPercent: -50, x: -100, y: -100 });
    var qx = gsap.quickTo(cur, 'x', { duration: 0.3, ease: 'power3.out' });
    var qy = gsap.quickTo(cur, 'y', { duration: 0.3, ease: 'power3.out' });
    var mx = 0, my = 0, active = false, text = '';
    function isInteractive(el) {
      if (!el) return false;
      return !!(el.closest && (el.closest('a') || el.closest('button')));
    }
    function refresh(el) {
      var host = el && el.closest ? el.closest('[data-cursor-text]') : null;
      var t = host ? host.getAttribute('data-cursor-text') : '';
      var on = !!t || isInteractive(el);
      if (on === active && t === text) return;
      active = on; text = t || '';
      label.textContent = text;
      gsap.to(dot, { rotation: on ? 45 : 0, duration: 0.3, ease: 'power2.out' });
      gsap.to(lv, { height: on ? '0.75rem' : 0, opacity: on ? 1 : 0, duration: 0.3, ease: 'power2.out' });
      gsap.to(lh, { width: on ? '0.75rem' : 0, opacity: on ? 1 : 0, duration: 0.3, ease: 'power2.out' });
      gsap.to(label, { opacity: text ? 1 : 0, duration: 0.3, ease: 'power2.out' });
    }
    function onMove(e) { mx = e.clientX; my = e.clientY; qx(mx); qy(my); }
    function onOver(e) { refresh(e.target); }
    var scrollCheck = function () { refresh(document.elementFromPoint(mx, my)); };
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseover', onOver);
    if (lenis) lenis.on('scroll', scrollCheck);
    return function () {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseover', onOver);
    };
  });

  /* ---------- resize safety: rebuild the rail, then refresh everything ---------- */
  var rto;
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    /* on touch the URL bar changes HEIGHT constantly while scrolling; a rebuild
       mid-fling resizes the document and iOS cancels the momentum. Only a WIDTH
       change (rotation, split view) is a real resize on touch. */
    if (isTouch && window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(rto);
    rto = setTimeout(function () {
      buildRailGrow();
      buildRail();
      ScrollTrigger.refresh();
    }, 250);
  });

  window.addEventListener('load', function () { ScrollTrigger.refresh(); });

})();

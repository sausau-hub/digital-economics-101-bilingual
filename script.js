(function () {
  function setMode(mode) {
    document.body.classList.remove('show-en-only', 'show-zh-only');
    if (mode === 'en') document.body.classList.add('show-en-only');
    if (mode === 'zh') document.body.classList.add('show-zh-only');
    try { localStorage.setItem('lang-mode', mode); } catch (e) {}
    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  function initLangToggle() {
    var saved = 'both';
    try { saved = localStorage.getItem('lang-mode') || 'both'; } catch (e) {}
    setMode(saved);
    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
    });
  }

  // ---- Sentence-by-sentence interleave (mainly for phones) ----
  // For rows that are plain paragraphs (no bullet list), tag them with .interleave and
  // give each <p> a CSS "order" so the mobile stylesheet can lay them out as
  // EN sentence, ZH sentence, EN sentence, ZH sentence... (see the .interleave rules
  // in style.css). Desktop's two-column layout is untouched — order only takes effect
  // once the mobile media query switches col-en/col-zh to display:contents.
  function initInterleave() {
    document.querySelectorAll('.bi-row').forEach(function (row) {
      var colEn = row.querySelector('.col-en');
      var colZh = row.querySelector('.col-zh');
      if (!colEn || !colZh) return;
      if (colEn.querySelector('ul') || colZh.querySelector('ul')) return;
      var enPs = Array.prototype.slice.call(colEn.querySelectorAll('p'));
      var zhPs = Array.prototype.slice.call(colZh.querySelectorAll('p'));
      if (!enPs.length || !zhPs.length) return;
      row.classList.add('interleave');
      var n = Math.max(enPs.length, zhPs.length);
      for (var i = 0; i < n; i++) {
        if (enPs[i]) enPs[i].style.order = String(i * 2 + 1);
        if (zhPs[i]) zhPs[i].style.order = String(i * 2 + 2);
      }
    });
  }

  // ---- English read-aloud ----
  // Primary source: pre-rendered neural-voice mp3 clips in ./audio/<id>.mp3 (one per
  // paragraph/bullet, generated offline with edge-tts). Falls back to the browser's
  // built-in Web Speech API only if a clip is missing.
  function initTTS() {
    var allEnBlocks = Array.prototype.slice.call(document.querySelectorAll('.col-en'));
    if (!allEnBlocks.length) return;

    var hasBrowserTTS = ('speechSynthesis' in window) && typeof SpeechSynthesisUtterance !== 'undefined';

    function unitsOf(container) {
      var nodes = container.querySelectorAll('p, li');
      return nodes.length ? Array.prototype.slice.call(nodes) : [container];
    }

    // Pairs each English paragraph/bullet with the Chinese paragraph/bullet at the same
    // position in the sibling .col-zh, so both can be highlighted together while reading.
    function pairUnits(colEn) {
      var enUnits = unitsOf(colEn);
      var row = colEn.closest('.bi-row');
      var zhUnits = [];
      if (row) {
        var colZh = row.querySelector('.col-zh');
        if (colZh) zhUnits = unitsOf(colZh);
      }
      return enUnits.map(function (enEl, i) {
        return { en: enEl, zh: zhUnits[i] || null };
      });
    }

    // Fallback browser voice, only used if a pre-recorded clip fails to load.
    var voices = [];
    function loadVoices() { if (hasBrowserTTS) voices = window.speechSynthesis.getVoices(); }
    loadVoices();
    if (hasBrowserTTS && 'onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    function scoreVoice(v) {
      var name = v.name || '';
      var score = 0;
      if (/^en/i.test(v.lang)) score += 10;
      if (/^en-(US|GB)/i.test(v.lang)) score += 3;
      if (/online|natural|neural/i.test(name)) score += 25;
      if (/desktop/i.test(name)) score -= 8;
      return score;
    }
    function fallbackVoice() {
      var en = voices.filter(function (v) { return /^en/i.test(v.lang); })
        .sort(function (a, b) { return scoreVoice(b) - scoreVoice(a); });
      return en[0] || null;
    }

    var savedRate = 1;
    try { savedRate = parseFloat(localStorage.getItem('tts-rate')) || 1; } catch (e) {}

    function clearHighlight() {
      var actives = document.querySelectorAll('.tts-active');
      for (var i = 0; i < actives.length; i++) actives[i].classList.remove('tts-active');
    }
    function clearSpeakingBtns() {
      var btns = document.querySelectorAll('.tts-btn.speaking, .tts-global-btn.speaking');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('speaking');
    }

    var currentAudio = null;
    var session = { running: false, cancelRequested: false };

    function stopAllSpeech() {
      session.running = false;
      session.cancelRequested = true;
      if (hasBrowserTTS) window.speechSynthesis.cancel();
      if (currentAudio) {
        try { currentAudio.pause(); currentAudio.currentTime = 0; } catch (e) {}
        currentAudio = null;
      }
      clearHighlight();
      clearSpeakingBtns();
    }

    function speakUnits(units, activeBtn, onEnd) {
      stopAllSpeech();
      var mySession = { running: true, cancelRequested: false };
      session = mySession;
      if (activeBtn) activeBtn.classList.add('speaking');
      var idx = 0;

      function finishAll() {
        mySession.running = false;
        clearHighlight();
        if (activeBtn) activeBtn.classList.remove('speaking');
        if (onEnd) onEnd();
      }

      function speakViaBrowser(text, onDone) {
        if (!hasBrowserTTS) { onDone(); return; }
        var utter = new SpeechSynthesisUtterance(text);
        var v = fallbackVoice();
        if (v) { utter.voice = v; utter.lang = v.lang; } else { utter.lang = 'en-US'; }
        utter.rate = savedRate;
        utter.onend = onDone;
        utter.onerror = onDone;
        window.speechSynthesis.speak(utter);
      }

      function next() {
        if (mySession.cancelRequested || idx >= units.length) { finishAll(); return; }
        var pair = units[idx];
        var el = pair.en;
        var zhEl = pair.zh;
        var text = (el.innerText || el.textContent || '').trim();
        if (!text) { idx += 1; next(); return; }

        clearHighlight();
        el.classList.add('tts-active');
        if (zhEl) zhEl.classList.add('tts-active');
        if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        var advance = function () {
          if (mySession.cancelRequested) return;
          idx += 1;
          next();
        };

        var uid = el.id;
        if (uid && /^tts-/.test(uid)) {
          var audio = new Audio('audio/' + uid + '.mp3');
          audio.playbackRate = savedRate;
          currentAudio = audio;
          var usedFallback = false;
          audio.addEventListener('ended', advance);
          audio.addEventListener('error', function () {
            if (usedFallback) return;
            usedFallback = true;
            speakViaBrowser(text, advance);
          });
          audio.play().catch(function () {
            if (usedFallback) return;
            usedFallback = true;
            speakViaBrowser(text, advance);
          });
        } else {
          speakViaBrowser(text, advance);
        }
      }
      next();
    }

    // Per-section 🔊 button — reads that whole section's English paragraphs/bullets in order.
    // Click-to-read — click any single paragraph/bullet (English or its paired Chinese one)
    // to hear just that sentence; click it again (or click elsewhere) to stop.
    allEnBlocks.forEach(function (el) {
      var unitPairs = pairUnits(el);

      unitPairs.forEach(function (pair) {
        var onUnitClick = function (e) {
          e.stopPropagation();
          var isThisPlaying = pair.en.classList.contains('tts-active') && session.running;
          stopAllSpeech();
          if (isThisPlaying) return;
          speakUnits([pair], null, null);
        };
        pair.en.classList.add('tts-clickable');
        pair.en.addEventListener('click', onUnitClick);
        if (pair.zh) {
          pair.zh.classList.add('tts-clickable');
          pair.zh.addEventListener('click', onUnitClick);
        }
      });

      var bar = document.createElement('div');
      bar.className = 'tts-bar';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tts-btn';
      btn.title = '朗读整段英文 Read this whole section aloud';
      btn.innerHTML = '&#128266; 朗读';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasSpeaking = btn.classList.contains('speaking') || session.running;
        stopAllSpeech();
        if (wasSpeaking) return;
        speakUnits(unitPairs, btn, null);
      });
      bar.appendChild(btn);
      el.insertBefore(bar, el.firstChild);
    });

    // Global "read whole lesson" control + speed picker, injected into the top nav.
    var navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;

    var playAllBtn = document.createElement('button');
    playAllBtn.type = 'button';
    playAllBtn.className = 'tts-global-btn';
    playAllBtn.textContent = '▶ 朗读全文 EN';
    navLinks.appendChild(playAllBtn);

    var rateSelect = document.createElement('select');
    rateSelect.className = 'tts-rate-select';
    rateSelect.title = '朗读速度 Speed';
    [['0.8', '0.8x'], ['0.9', '0.9x'], ['1', '1.0x'], ['1.1', '1.1x'], ['1.25', '1.25x']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      if (parseFloat(pair[0]) === savedRate) opt.selected = true;
      rateSelect.appendChild(opt);
    });
    rateSelect.addEventListener('change', function () {
      savedRate = parseFloat(rateSelect.value) || 1;
      try { localStorage.setItem('tts-rate', String(savedRate)); } catch (e) {}
      if (currentAudio) currentAudio.playbackRate = savedRate;
    });
    navLinks.appendChild(rateSelect);

    playAllBtn.addEventListener('click', function () {
      var wasRunning = session.running;
      stopAllSpeech();
      if (wasRunning) { playAllBtn.classList.remove('speaking'); playAllBtn.textContent = '▶ 朗读全文 EN'; return; }
      playAllBtn.classList.add('speaking');
      playAllBtn.textContent = '⏸ 停止朗读';
      var allUnits = [];
      allEnBlocks.forEach(function (el) { allUnits = allUnits.concat(pairUnits(el)); });
      speakUnits(allUnits, playAllBtn, function () {
        playAllBtn.textContent = '▶ 朗读全文 EN';
      });
    });

    window.addEventListener('beforeunload', function () {
      if (hasBrowserTTS) { try { window.speechSynthesis.cancel(); } catch (e) {} }
      if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initLangToggle();
    initInterleave();
    initTTS();
  });
})();

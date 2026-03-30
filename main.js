// ─── State ───────────────────────────────────────────────────────────────────
let isSystemLive       = false;
let isPaused           = false;
let clockInterval;
let exactCurrentSeconds  = 0;
let targetFinishTimestamp = 0;
let lastTickTime         = 0;

// Tracks whether the user has touched each field group
// so we don't yell at them before they've had a chance to type
const touched = { total: false, current: false, speed: false };

// ─── Validation ──────────────────────────────────────────────────────────────
function getValues() {
    const totH = parseInt(document.getElementById('totalH').value)  || 0;
    const totM = parseInt(document.getElementById('totalM').value)  || 0;
    const totS = parseInt(document.getElementById('totalS').value)  || 0;
    const curH = parseInt(document.getElementById('currH').value)   || 0;
    const curM = parseInt(document.getElementById('currM').value)   || 0;
    const curS = parseInt(document.getElementById('currS').value)   || 0;
    const speed = parseFloat(document.getElementById('speed').value) || 0;
    return {
        total:   (totH * 3600) + (totM * 60) + totS,
        current: (curH * 3600) + (curM * 60) + curS,
        speed,
    };
}

function validateAndUpdateButton() {
    if (isSystemLive) return; // never alter button while live

    const { total, current, speed } = getValues();
    const hint = document.getElementById('validationHint');
    const btn  = document.getElementById('calcBtn');

    // Determine validity + what message to show
    let msg     = '';
    let isValid = false;

    if (total === 0) {
        // Only show the hint once they've interacted with the total fields
        if (touched.total) msg = 'Enter a total duration to start tracking.';
    } else if (speed <= 0) {
        msg = 'Speed must be greater than 0.';
    } else if (current > 0 && current >= total) {
        msg = 'Current progress can\'t exceed total duration.';
        // Highlight the offending current-progress inputs
        ['currH','currM','currS'].forEach(id => {
            document.getElementById(id).classList.add('input-invalid');
        });
    } else {
        isValid = true;
        // Clear any lingering red borders
        ['currH','currM','currS'].forEach(id => {
            document.getElementById(id).classList.remove('input-invalid');
        });
    }

    // If it just became valid, clear red borders and message
    if (isValid) {
        ['currH','currM','currS'].forEach(id => {
            document.getElementById(id).classList.remove('input-invalid');
        });
    }

    hint.textContent = msg;

    if (isValid) {
        btn.disabled = false;
        btn.setAttribute('aria-disabled', 'false');
        btn.classList.remove('btn-ready-disabled');
        btn.classList.add('btn-idle');
    } else {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.classList.add('btn-ready-disabled');
        btn.classList.remove('btn-idle');
    }
}

// ─── Clamp minute / second fields to 0–59 ────────────────────────────────────
function clampMinSec(input) {
    if (['currM','currS','totalM','totalS'].includes(input.id)) {
        const v = parseInt(input.value);
        if (!isNaN(v)) {
            if (v > 59) input.value = 59;
            if (v < 0)  input.value = 0;
        }
    }
}

// ─── Input wiring ─────────────────────────────────────────────────────────────
const autoAdvanceMap = { currH: 'currM', currM: 'currS', totalH: 'totalM', totalM: 'totalS' };
const totalIds   = ['totalH','totalM','totalS'];
const currentIds = ['currH','currM','currS'];

document.querySelectorAll('input[type="number"]').forEach(input => {

    // Mark relevant field group as touched on first input
    input.addEventListener('input', () => {
        clampMinSec(input);

        if (totalIds.includes(input.id))   touched.total   = true;
        if (currentIds.includes(input.id)) touched.current = true;
        if (input.id === 'speed')          touched.speed   = true;

        // Auto-advance to next H→M→S field after 2 digits
        const nextId = autoAdvanceMap[input.id];
        if (nextId && String(input.value).length >= 2) {
            const next = document.getElementById(nextId);
            next.focus();
            next.select();
        }

        if (isSystemLive) {
            performCalculations(false);
        } else {
            validateAndUpdateButton();
        }
    });

    // Scroll wheel adjusts values
    input.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step      = parseFloat(input.step) || 1;
        const direction = e.deltaY > 0 ? -1 : 1;
        let newValue    = parseFloat(input.value || 0) + (direction * step);
        const min = input.hasAttribute('min') ? parseFloat(input.min) : -Infinity;
        const max = input.hasAttribute('max') ? parseFloat(input.max) : Infinity;
        if (newValue < min) newValue = min;
        if (newValue > max) newValue = max;
        input.value = step < 1 ? newValue.toFixed(2) : Math.round(newValue);
        clampMinSec(input);

        if (totalIds.includes(input.id))   touched.total   = true;
        if (currentIds.includes(input.id)) touched.current = true;
        if (input.id === 'speed')          touched.speed   = true;

        if (isSystemLive) performCalculations(false);
        else validateAndUpdateButton();
    });

    input.addEventListener('focus', function () { this.select(); });

    // Mark touched on blur too, so tabbing past an empty total field shows hint
    input.addEventListener('blur', () => {
        if (totalIds.includes(input.id))   touched.total   = true;
        if (currentIds.includes(input.id)) touched.current = true;
        if (input.id === 'speed')          touched.speed   = true;
        if (!isSystemLive) validateAndUpdateButton();
    });
});

// ─── Start / Pause / Resume ──────────────────────────────────────────────────
function toggleLiveSystem() {
    const btn        = document.getElementById('calcBtn');
    const badge      = document.getElementById('liveBadge');
    const badgeDot   = document.getElementById('liveDot');
    const badgeText  = document.getElementById('liveText');
    const results    = document.getElementById('results');
    const hint       = document.getElementById('validationHint');

    const baseBtnClasses = "btn-base flex-1 min-w-0 font-bold py-4 sm:py-5 px-2 sm:px-8 rounded-xl sm:rounded-2xl transform active:scale-95 text-xs sm:text-xl uppercase tracking-widest ";

    if (!isSystemLive) {
        // ── START ──────────────────────────────────────────────────────────
        // Guard: re-validate in case someone bypasses the disabled attribute
        const { total, current, speed } = getValues();
        if (total === 0 || speed <= 0 || current >= total) return;

        isSystemLive = true;
        isPaused     = false;

        // Clear validation hint while live
        hint.textContent = '';

        // Hide reset button if leftover from a previous completion
        const resetBtn = document.getElementById('resetBtn');
        resetBtn.classList.add('hidden');
        resetBtn.classList.remove('flex');

        // Show the subtle corner reset
        const cornerBtn = document.getElementById('cornerResetBtn');
        cornerBtn.classList.remove('hidden');
        cornerBtn.classList.add('flex');

        btn.disabled = false;
        btn.setAttribute('aria-disabled', 'false');
        btn.textContent  = "Pause";
        btn.className    = baseBtnClasses + "btn-live";

        badge.className  = "flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 sm:px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
        badgeDot.className = "w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400 tracking-dot";
        badgeText.textContent = "Tracking";
        badge.classList.remove('hidden');

        results.classList.remove('hidden');

        performCalculations(false);

        if (clockInterval) clearInterval(clockInterval);
        clockInterval = setInterval(() => {
            if (isSystemLive) performCalculations(true);
        }, 1000);

    } else if (!isPaused) {
        // ── PAUSE ──────────────────────────────────────────────────────────
        isPaused = true;

        btn.textContent = "Resume";
        btn.className   = baseBtnClasses + "btn-paused";

        badge.className = "flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 sm:px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400";
        badgeDot.className = "w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-amber-400";
        badgeText.textContent = "Paused";

        lastTickTime = Date.now();

    } else {
        // ── RESUME ─────────────────────────────────────────────────────────
        isPaused = false;

        btn.textContent = "Pause";
        btn.className   = baseBtnClasses + "btn-live";

        badge.className = "flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 sm:px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
        badgeDot.className = "w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400 tracking-dot";
        badgeText.textContent = "Tracking";

        lastTickTime = Date.now();
    }
}

// ─── Reset ───────────────────────────────────────────────────────────────────
function resetSystem() {
    clearInterval(clockInterval);

    isSystemLive          = false;
    isPaused              = false;
    exactCurrentSeconds   = 0;
    targetFinishTimestamp = 0;
    lastTickTime          = 0;
    touched.total         = false;
    touched.current       = false;
    touched.speed         = false;

    // Clear all inputs
    ['currH','currM','currS'].forEach(id => {
        const el = document.getElementById(id);
        el.value = '';
        el.classList.remove('input-invalid');
    });
    ['totalH','totalM','totalS'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('speed').value = '1.00';
    document.getElementById('speedPresetLabel').textContent = 'Preset';
    document.querySelectorAll('.custom-select-option').forEach(opt => opt.setAttribute('aria-selected', 'false'));
    closeSpeedDropdown();

    // Clear validation hint
    document.getElementById('validationHint').textContent = '';

    // Reset button to disabled state
    const btn = document.getElementById('calcBtn');
    btn.textContent = "Start Tracking";
    btn.className   = "btn-base btn-ready-disabled flex-1 min-w-0 font-bold py-4 sm:py-5 px-2 sm:px-8 rounded-xl sm:rounded-2xl transform active:scale-95 text-xs sm:text-xl uppercase tracking-widest";
    btn.disabled    = true;
    btn.setAttribute('aria-disabled', 'true');

    // Hide reset buttons
    document.getElementById('resetBtn').classList.add('hidden');
    document.getElementById('resetBtn').classList.remove('flex');
    document.getElementById('cornerResetBtn').classList.add('hidden');
    document.getElementById('cornerResetBtn').classList.remove('flex');

    // Hide completion overlay and reset its animations
    const overlay = document.getElementById('completionOverlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('overlay-in');
    const circle = document.getElementById('checkCircle');
    const check  = document.getElementById('checkMark');
    circle.style.transition    = '';
    circle.style.strokeDashoffset = '226';
    check.style.transition     = '';
    check.style.strokeDashoffset = '50';

    // Hide badge and results
    document.getElementById('liveBadge').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');

    // Reset result displays
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('savedTimeRow').classList.add('hidden');
}

// ─── Completion overlay ───────────────────────────────────────────────────────
function showCompletionOverlay(durationSecs, speed) {
    const dH = Math.floor(durationSecs / 3600);
    const dM = Math.floor((durationSecs % 3600) / 60);
    const dS = Math.floor(durationSecs % 60);
    const durStr = dH > 0 ? `${dH}h ${dM}m` : dM > 0 ? `${dM}m ${dS}s` : `${dS}s`;

    let savedStr  = '—';
    let savedSecs = 0;
    if (speed > 1) {
        savedSecs = Math.max(0, durationSecs - durationSecs / speed);
        const sH  = Math.floor(savedSecs / 3600);
        const sM  = Math.floor((savedSecs % 3600) / 60);
        const sS  = Math.floor(savedSecs % 60);
        savedStr  = sH > 0 ? `${sH}h ${sM}m` : sM > 0 ? `${sM}m ${sS}s` : `${sS}s`;
    }

    const now          = new Date();
    const finishedHour = now.getHours();
    const finishedAtStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

    // Tier taglines
    let tagline = 'Here\'s how your session went';
    if      (speed < 1)             tagline = 'Slow and steady. You really savoured it.';
    else if (speed === 1)            tagline = 'Full pace. No shortcuts, no regrets.';
    else if (savedSecs < 60)         tagline = 'Every second counts. Even these ones.';
    else if (savedSecs < 300)        tagline = 'A little time saved goes a long way.';
    else if (savedSecs < 600)        tagline = 'That\'s a coffee break reclaimed.';
    else if (savedSecs < 1800)       tagline = 'A solid chunk of time back in your day.';
    else if (savedSecs < 3600)       tagline = 'Over half an hour saved — well spent.';
    else if (savedSecs < 7200)       tagline = 'You reclaimed over an hour. Nice.';
    else if (savedSecs < 10800)      tagline = 'Two hours saved. That\'s basically a movie.';
    else if (savedSecs < 18000)      tagline = 'Three+ hours saved. You\'re speedrunning life.';
    else if (savedSecs < 28800)      tagline = 'Five hours saved? Are you even watching or just vibing?';
    else if (savedSecs < 36000)      tagline = 'Eight hours saved. That\'s a full sleep cycle you reclaimed.';
    else if (savedSecs < 50400)      tagline = 'Ten hours saved. You basically skipped an entire workday.';
    else if (savedSecs < 64800)      tagline = 'Fourteen hours saved. You\'re not watching content, you\'re harvesting it.';
    else if (savedSecs < 86400)      tagline = 'Over eighteen hours saved. That\'s a full day back. Unreal.';
    else {
        const savedHrs = Math.round(savedSecs / 3600);
        tagline = `${savedHrs} hours saved. Time is officially broken now.`;
    }

    // Easter eggs
    if (finishedHour >= 1 && finishedHour < 5) tagline = `Done at ${finishedAtStr}. Go to sleep. Seriously.`;
    if (finishedHour === 0)                     tagline = 'Midnight finisher. The streets respect you.';

    if (speed === 0.75) tagline = '0.75×. Slowing it down. Every word mattered to you.';
    if (speed === 1.25) tagline = '1.25×. The subtle speedster. YouTube approves.';
    if (speed === 1.5)  tagline = '1.5×. The classic sweet spot. Certified speedwatcher.';
    if (speed === 1.75) tagline = '1.75×. Chaos gremlin energy. Respect.';
    if (speed === 2)    tagline = '2×. You weren\'t watching — you were processing.';
    if (speed === 3)    tagline = '3×? You weren\'t watching, you were scanning for keywords.';
    if (speed >= 4)     tagline = `${speed}×? At that speed it's not a video, it's morse code.`;

    if (durationSecs >= 36000 && durationSecs < 57600)
        tagline = `A ${Math.round(durationSecs/3600)}h video. That's not a watch, that's a commitment.`;
    if (durationSecs >= 57600)
        tagline = `A ${Math.round(durationSecs/3600)}h video. That's longer than a workday. Unhinged.`;

    if (savedSecs > durationSecs * 0.55)
        tagline = 'You saved more time than you spent. Paradox unlocked.';
    if (durationSecs >= 60000 && savedSecs >= 36000)
        tagline = `An ${Math.round(durationSecs/3600)}h video, ${Math.round(savedSecs/3600)}h saved. This wasn't watching — this was a data transfer.`;
    if (speed >= 2 && durationSecs >= 36000 && savedSecs >= 18000)
        tagline = `${speed}× on a ${Math.round(durationSecs/3600)}h video. Elite-level content consumption. Terrifying.`;

    document.getElementById('statDuration').textContent  = durStr;
    document.getElementById('statSpeed').textContent     = speed.toFixed(2) + '×';
    document.getElementById('statSaved').textContent     = savedStr;
    document.getElementById('statFinishedAt').textContent = finishedAtStr;
    document.getElementById('overlayTagline').textContent = tagline;

    const overlay = document.getElementById('completionOverlay');
    overlay.classList.remove('hidden');
    void overlay.offsetWidth; // trigger reflow so animation fires fresh
    overlay.classList.add('overlay-in');

    // Animate checkmark: circle draws first, then tick
    const circle = document.getElementById('checkCircle');
    const check  = document.getElementById('checkMark');
    circle.style.transition      = 'stroke-dashoffset 0.65s cubic-bezier(0.4, 0, 0.2, 1)';
    check.style.transition       = '';
    check.style.strokeDashoffset = '50';
    setTimeout(() => {
        circle.style.strokeDashoffset = '0';
        setTimeout(() => {
            check.style.transition       = 'stroke-dashoffset 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
            check.style.strokeDashoffset = '0';
        }, 500);
    }, 50);

    setTimeout(() => {
        document.getElementById('overlayTrackAnotherBtn')?.focus();
    }, 550);
}

// Focus trap for completion overlay
document.getElementById('completionOverlay').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = document.getElementById('completionOverlay').querySelectorAll('button, [tabindex="0"]');
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first)       { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last)  { e.preventDefault(); first.focus(); }
});

// ─── Core calculation tick ────────────────────────────────────────────────────
function performCalculations(isTickUpdate = false) {
    const totH = parseInt(document.getElementById('totalH').value) || 0;
    const totM = parseInt(document.getElementById('totalM').value) || 0;
    const totS = parseInt(document.getElementById('totalS').value) || 0;
    const durationTotalSeconds = (totH * 3600) + (totM * 60) + totS;
    const speed = parseFloat(document.getElementById('speed').value) || 1;

    if (speed <= 0) { showError("Speed must be greater than 0"); return; }

    if (!isTickUpdate) {
        const curH = parseInt(document.getElementById('currH').value) || 0;
        const curM = parseInt(document.getElementById('currM').value) || 0;
        const curS = parseInt(document.getElementById('currS').value) || 0;
        exactCurrentSeconds = (curH * 3600) + (curM * 60) + curS;
        lastTickTime = Date.now();
        const secondsLeft = Math.max(0, durationTotalSeconds - exactCurrentSeconds);
        targetFinishTimestamp = Date.now() + (secondsLeft / speed) * 1000;
    } else {
        const now = Date.now();
        const elapsedRealSeconds = (now - lastTickTime) / 1000;
        lastTickTime = now;

        if (!isPaused) {
            exactCurrentSeconds += (elapsedRealSeconds * speed);

            if (exactCurrentSeconds >= durationTotalSeconds) {
                exactCurrentSeconds = durationTotalSeconds;
                clearInterval(clockInterval);
                isSystemLive = false;
                isPaused     = false;

                const btn = document.getElementById('calcBtn');
                btn.textContent = "Finished!";
                btn.className   = "btn-base flex-1 min-w-0 font-bold py-4 sm:py-5 px-2 sm:px-8 rounded-xl sm:rounded-2xl text-xs sm:text-xl uppercase tracking-widest bg-zinc-800 text-zinc-400 cursor-default";
                document.getElementById('liveBadge').classList.add('hidden');
                document.getElementById('cornerResetBtn').classList.add('hidden');
                document.getElementById('cornerResetBtn').classList.remove('flex');

                setTimeout(() => showCompletionOverlay(durationTotalSeconds, speed), 600);
            }

            document.getElementById('currH').value = Math.floor(exactCurrentSeconds / 3600);
            document.getElementById('currM').value = Math.floor((exactCurrentSeconds % 3600) / 60);
            document.getElementById('currS').value = Math.floor(exactCurrentSeconds % 60);
        }

        const secondsLeft = Math.max(0, durationTotalSeconds - exactCurrentSeconds);
        targetFinishTimestamp = Date.now() + (secondsLeft / speed) * 1000;
    }

    if (durationTotalSeconds <= exactCurrentSeconds && !isTickUpdate) {
        if (durationTotalSeconds > 0) showError("Progress exceeds total duration");
        return;
    }

    // Progress bar
    let progressPercent = 0;
    if (durationTotalSeconds > 0) {
        progressPercent = Math.min(100, Math.max(0, (exactCurrentSeconds / durationTotalSeconds) * 100));
    }
    const progressFill = document.getElementById('progressFill');
    progressFill.style.transition = isTickUpdate && !isPaused ? 'width 1s linear' : 'width 0.3s ease-out';
    progressFill.style.width = `${progressPercent}%`;

    // Remaining time display
    const secondsLeft     = Math.max(0, durationTotalSeconds - exactCurrentSeconds);
    const actualSecondsToWait = secondsLeft / speed;
    const remH = Math.floor(actualSecondsToWait / 3600);
    const remM = Math.floor((actualSecondsToWait % 3600) / 60);
    const remS = Math.floor(actualSecondsToWait % 60);

    document.getElementById('remainingDisplay').innerHTML =
        `${remH}<span class="text-indigo-300 text-xl sm:text-2xl md:text-3xl font-medium ml-1 mr-2 sm:mr-3">h</span> ` +
        `${remM}<span class="text-indigo-300 text-xl sm:text-2xl md:text-3xl font-medium ml-1 mr-2 sm:mr-3">m</span> ` +
        `${remS}<span class="text-indigo-300 text-xl sm:text-2xl md:text-3xl font-medium ml-1">s</span>`;

    document.getElementById('speedLabel').textContent = speed.toFixed(2);

    // Time saved row
    const savedTimeRow     = document.getElementById('savedTimeRow');
    const savedTimeDisplay = document.getElementById('savedTimeDisplay');
    if (speed > 1 && durationTotalSeconds > 0) {
        const savedSeconds = Math.max(0, durationTotalSeconds - durationTotalSeconds / speed);
        const svH = Math.floor(savedSeconds / 3600);
        const svM = Math.floor((savedSeconds % 3600) / 60);
        const svS = Math.floor(savedSeconds % 60);
        let savedStr = '';
        if (svH > 0) savedStr += `${svH}h `;
        if (svM > 0 || svH > 0) savedStr += `${svM}m `;
        savedStr += `${svS}s`;
        savedTimeDisplay.textContent = savedStr.trim();
        savedTimeRow.classList.remove('hidden');
    } else {
        savedTimeRow.classList.add('hidden');
    }

    // Finish time
    const finishDate = new Date(targetFinishTimestamp);
    document.getElementById('finishClockDisplay').textContent =
        finishDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    const now         = new Date();
    const todayMid    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const finishMid   = new Date(finishDate.getFullYear(), finishDate.getMonth(), finishDate.getDate());
    const diffDays    = Math.round((finishMid - todayMid) / (1000 * 60 * 60 * 24));

    let dateText  = "Finishing today";
    let dateClass = "text-zinc-400";
    if (diffDays === 1) {
        dateText  = "Finishing tomorrow";
        dateClass = "text-amber-400";
    } else if (diffDays > 1) {
        const dateStr = finishDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        dateText  = `Finishing on ${dateStr}`;
        dateClass = "text-indigo-400";
    }
    document.getElementById('finishDateLabel').textContent  = dateText;
    document.getElementById('finishDateLabel').className    = `text-sm sm:text-base italic font-medium ${dateClass}`;
}

function showError(msg) {
    document.getElementById('remainingDisplay').innerHTML = '<span class="text-2xl sm:text-3xl text-red-400">Invalid Range</span>';
    document.getElementById('finishClockDisplay').textContent = "--:-- --";
    document.getElementById('finishDateLabel').textContent    = msg;
    document.getElementById('finishDateLabel').className      = "text-sm sm:text-base italic font-medium text-red-400";
    document.getElementById('progressFill').style.width       = '0%';
    document.getElementById('savedTimeRow').classList.add('hidden');
}

// ─── Speed preset dropdown ────────────────────────────────────────────────────
function toggleSpeedDropdown() {
    const panel   = document.getElementById('speedPresetPanel');
    const trigger = document.getElementById('speedPresetTrigger');
    const isOpen  = !panel.classList.contains('hidden');
    if (isOpen) {
        panel.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    } else {
        panel.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
        panel.querySelector('.custom-select-option')?.focus();
    }
}

function closeSpeedDropdown() {
    document.getElementById('speedPresetPanel').classList.add('hidden');
    document.getElementById('speedPresetTrigger').setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (e) => {
    if (!document.getElementById('speedPresetWrapper').contains(e.target)) {
        closeSpeedDropdown();
    }
});

document.getElementById('speedPresetPanel').addEventListener('keydown', (e) => {
    const options = [...document.querySelectorAll('.custom-select-option')];
    const focused = document.activeElement;
    const idx     = options.indexOf(focused);
    if (e.key === 'ArrowDown') { e.preventDefault(); options[Math.min(idx + 1, options.length - 1)]?.focus(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); options[Math.max(idx - 1, 0)]?.focus(); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focused.click(); }
    if (e.key === 'Escape') { closeSpeedDropdown(); document.getElementById('speedPresetTrigger').focus(); }
});

function applySpeedPreset(val) {
    if (!val) return;
    const numVal = parseFloat(val);
    document.getElementById('speed').value = numVal.toFixed(2);
    document.getElementById('speedPresetLabel').textContent = numVal + '×';
    document.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.setAttribute('aria-selected', opt.dataset.value === String(val));
    });
    closeSpeedDropdown();
    touched.speed = true;
    if (isSystemLive) performCalculations(false);
    else validateAndUpdateButton();
}

// Reset preset label when user types manually
document.getElementById('speed').addEventListener('input', () => {
    document.getElementById('speedPresetLabel').textContent = 'Preset';
    document.querySelectorAll('.custom-select-option').forEach(opt => opt.setAttribute('aria-selected', 'false'));
});

// ─── Copy finish time ─────────────────────────────────────────────────────────
function copyFinishTime() {
    const time = document.getElementById('finishClockDisplay').textContent;
    if (time === '--:-- --') return;
    navigator.clipboard.writeText(time).then(() => {
        const btn  = document.getElementById('copyBtn');
        const icon = document.getElementById('copyIcon');
        icon.innerHTML = '<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>';
        btn.style.color = '#10b981';
        setTimeout(() => {
            icon.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';
            btn.style.color = '';
        }, 1600);
    });
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
    if (e.code === 'Space' && isSystemLive) {
        e.preventDefault();
        toggleLiveSystem();
    }
    if (e.code === 'Enter' && !isSystemLive) {
        e.preventDefault();
        const btn = document.getElementById('calcBtn');
        if (!btn.disabled) toggleLiveSystem();
    }
});

// ─── PWA service worker registration ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {
            // SW registration failed — app still works online
        });
    });
}

// ---------------------------------------------------------------------------
// Java <-> JS bridge
//
// App.java injects a Java object as `window.javaBridge` once the page has
// loaded, then calls window.onJavaBridgeReady(). Everything in this file goes
// through the `desk` facade below, so the page also works when opened in a
// normal browser (no Java): calls are just logged to the browser console.
// ---------------------------------------------------------------------------
const desk = {
  get bridge() {
    return window.javaBridge || null;
  },
  minimize() {
    if (this.bridge) this.bridge.minimize();
  },
  close() {
    if (this.bridge) this.bridge.close();
  },
  togglePin() {
    return this.bridge ? this.bridge.togglePin() : false;
  },
  fitHeight(height) {
    if (this.bridge) this.bridge.fitHeight(Math.ceil(height));
  },
  // Java animates the window width, then calls onWindowExpanded / onWindowCollapsed.
  // Without Java (plain browser) those callbacks are called directly.
  expandWindow(type) {
    if (this.bridge) this.bridge.expandWindow(type);
    else window.onWindowExpanded(type);
  },
  collapseWindow() {
    if (this.bridge) this.bridge.collapseWindow();
    else window.onWindowCollapsed();
  },
  // MQTT-style publish: Java side logs it (and can forward it to a real broker)
  publish(topic, data) {
    const json = JSON.stringify(data);
    if (this.bridge) this.bridge.publish(topic, json);
    else console.log('[publish]', topic, json);
  },
};

// Called by Java right after window.javaBridge is injected
window.onJavaBridgeReady = function () {
  // Forward console.log / console.error to the Java console
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => { desk.bridge.log('INFO', args.join(' ')); origLog(...args); };
  console.error = (...args) => { desk.bridge.log('ERROR', args.join(' ')); origError(...args); };
  window.onerror = (msg, src, line) => desk.bridge.log('ERROR', `${msg} (${src}:${line})`);

  // Fit the Java window height to the main column (card + shadow padding).
  // The detail column stretches to the same height, so it never decides the height.
  const mainColumn = document.getElementById('mainColumn');
  const fit = () => desk.fitHeight(mainColumn.offsetHeight);
  if (window.ResizeObserver) {
    new ResizeObserver(fit).observe(mainColumn);
  }
  fit();

  console.log('JS bridge ready');
};

// Called by Java (App.java -> window.onSensorUpdate(...)) to push data into the UI
window.onSensorUpdate = function (temperature, humidity) {
  document.getElementById('tempVal').textContent = `${temperature.toFixed(1)}°C`;
  document.getElementById('humVal').textContent = `${Math.round(humidity)}%`;
};

// Used by App.java to decide whether a mouse press at (x, y) should drag the window
window.isDragRegion = function (x, y) {
  const el = document.elementFromPoint(x, y);
  return !!(el && el.closest('[data-drag-region]') && !el.closest('[data-no-drag]'));
};

// ---------------------------------------------------------------------------
// Widget logic
// ---------------------------------------------------------------------------

// Handle Toggle Interactions with visual feedback and MQTT messages
function handleToggle(type, checkbox, topic) {
  const isChecked = checkbox.checked;
  const card = document.getElementById(`card-${type}`);

  // Visual active class
  card.classList.toggle('is-on', isChecked);

  // Dynamic sub-text updates
  if (type === 'bluetooth') {
    document.getElementById('bt-status').textContent = isChecked ? 'Audio Engine Connected' : 'Disconnected / Standby';
  }

  // Specific rule for Privacy guard: if ON, drop mic/cam
  if (type === 'privacy' && isChecked) {
    flashNotice('Privacy Mode Activated: Mic & Cam Cutoff');
  }

  // Dim light slider if lights are turned off
  if (type === 'light') {
    const sliderMod = document.getElementById('lightBrightnessModule');
    sliderMod.style.opacity = isChecked ? '1' : '0.4';
    sliderMod.style.pointerEvents = isChecked ? 'auto' : 'none';
  }

  const payload = {
    state: isChecked ? 'ON' : 'OFF',
    timestamp: new Date().toLocaleTimeString(),
    source: 'javafx-desk-widget'
  };

  publishLog(topic, payload);
  recalcPower();

  if (openDetailType === type) refreshDetailState();
}

// Handle Brightness Slider Change
let debounceTimer;
function handleSliderChange(val) {
  document.getElementById('sliderVal').textContent = `${val}%`;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    publishLog('office/desk/lights/dim', { brightness: parseInt(val, 10) });
  }, 150);
}

// Show in the on-screen log and send to Java
function publishLog(topic, data) {
  const logElement = document.getElementById('mqttPayload');
  logElement.innerHTML = `<strong>${topic}</strong> -> ${JSON.stringify(data)}`;

  // Ping flicker
  const pingElement = document.getElementById('pingMs');
  const randomPing = Math.floor(Math.random() * 8) + 11;
  pingElement.textContent = `ping: ${randomPing}ms`;

  desk.publish(topic, data);
}

// Quick Scene Presets
function applyScene(sceneName) {
  document.querySelectorAll('.scene-chip').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`scene-${sceneName}`).classList.add('active');

  const bt = document.getElementById('bluetooth');
  const light = document.getElementById('deskLight');
  const rig = document.getElementById('smartPlug');
  const privacy = document.getElementById('privacySwitch');
  const slider = document.getElementById('lightSlider');

  if (sceneName === 'work') {
    bt.checked = true;
    light.checked = true;
    rig.checked = true;
    privacy.checked = false;
    slider.value = 85;
  } else if (sceneName === 'meet') {
    bt.checked = true;
    light.checked = true;
    rig.checked = true;
    privacy.checked = false;
    slider.value = 100;
  } else if (sceneName === 'leave') {
    bt.checked = false;
    light.checked = false;
    rig.checked = false;
    privacy.checked = true;
    slider.value = 0;
  }

  // Trigger updates on all
  handleToggle('bluetooth', bt, 'office/desk/soundbar');
  handleToggle('light', light, 'office/desk/lights');
  handleToggle('rig', rig, 'office/desk/plug_main');
  handleToggle('privacy', privacy, 'office/desk/privacy_guard');
  handleSliderChange(slider.value);

  publishLog(`office/scenes/set`, { preset: sceneName.toUpperCase() });
}

// Dynamic Power calculation simulation
function recalcPower() {
  let watts = 0;
  if (document.getElementById('bluetooth').checked) watts += 14;
  if (document.getElementById('smartPlug').checked) watts += 115;
  if (document.getElementById('deskLight').checked) {
    const bright = parseInt(document.getElementById('lightSlider').value, 10);
    watts += Math.round(18 * (bright / 100));
  }
  document.getElementById('powerDraw').textContent = `${watts}W`;
}

// Pin Toggle (Always on Top) - Java returns the new state synchronously
function togglePin() {
  const isPinned = desk.togglePin();
  flashNotice(isPinned ? 'Pinned on top' : 'Unpinned');
  const pinBtn = document.getElementById('pinBtn');
  if (isPinned) {
    pinBtn.style.color = '#00b33c';
    pinBtn.style.boxShadow = 'inset -2px -2px 4px var(--shadow-light), inset 2px 2px 4px var(--shadow-dark)';
  } else {
    pinBtn.style.color = 'var(--text-muted)';
    pinBtn.style.boxShadow = '-3px -3px 6px var(--shadow-light), 3px 3px 6px var(--shadow-dark)';
  }
}

// Simple toast notice inside the log
function flashNotice(msg) {
  publishLog('system/widget/event', { notice: msg });
}

// ---------------------------------------------------------------------------
// Detail panel (expand / collapse)
// ---------------------------------------------------------------------------

let openDetailType = null;

// Clicking a card (but not its switch or slider) opens its details;
// clicking the already-open card closes them again.
document.getElementById('deskWidget').addEventListener('click', (e) => {
  const card = e.target.closest('.switch-holder[data-detail]');
  if (!card || e.target.closest('.switch-toggle, .slider-module')) return;

  const type = card.dataset.detail;
  if (type === openDetailType) closeDetail();
  else openDetail(type);
});

function openDetail(type) {
  const template = document.getElementById(`detail-${type}`);
  const card = document.getElementById(`card-${type}`);
  if (!template || !card) return;

  const wasOpen = openDetailType !== null;

  // Fill the right panel from the template, title and icon come from the card
  const body = document.getElementById('detailBody');
  body.replaceChildren(template.content.cloneNode(true));
  // Fade only when switching cards; on first open the window animation is the transition
  body.classList.remove('fade-in');
  if (wasOpen) {
    void body.offsetWidth; // restart the animation
    body.classList.add('fade-in');
  }

  document.getElementById('detailTitle').textContent = card.querySelector('.switch-info span').textContent;
  document.getElementById('detailIcon').className = card.querySelector('.icon-box i').className;

  document.querySelectorAll('.switch-holder.is-selected').forEach(c => c.classList.remove('is-selected'));
  card.classList.add('is-selected');

  openDetailType = type;
  refreshDetailState();
  if (!wasOpen) desk.expandWindow(type);

  publishLog('system/widget/detail', { open: type });
}

// 'Geri' button
function closeDetail() {
  if (openDetailType === null) return;
  openDetailType = null;
  document.querySelectorAll('.switch-holder.is-selected').forEach(c => c.classList.remove('is-selected'));
  desk.collapseWindow();
}

// Called by Java before expanding: 'left' when the window grows to the left
// (near the right screen edge), 'right' otherwise
window.setDetailSide = function (side) {
  document.body.classList.toggle('detail-left', side === 'left');
};

// Called by Java when the width animation has finished
window.onWindowExpanded = function (type) {
  console.log(`Detail panel open: ${type}`);
};

window.onWindowCollapsed = function () {
  // Clear the panel only if nothing was reopened during the animation
  if (openDetailType === null) {
    document.getElementById('detailBody').replaceChildren();
  }
};

// Values in the detail panel that mirror the main panel's switches
function refreshDetailState() {
  if (openDetailType === 'privacy') {
    const on = document.getElementById('privacySwitch').checked;
    document.querySelectorAll('[data-privacy-pill]').forEach(pill => {
      pill.textContent = on ? 'BLOCKED' : 'LIVE';
      pill.className = `pill ${on ? 'on' : 'off'}`;
    });
  }
}

// Controls inside the detail panel publish through data-topic attributes (see index.html)
const detailBody = document.getElementById('detailBody');

detailBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  const group = btn.closest('.seg');
  group.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  publishLog(group.dataset.topic, { value: btn.dataset.value });
});

detailBody.addEventListener('change', (e) => {
  const input = e.target;
  if (input.type === 'checkbox' && input.dataset.topic) {
    publishLog(input.dataset.topic, { state: input.checked ? 'ON' : 'OFF' });
  }
});

let detailSliderTimer;
detailBody.addEventListener('input', (e) => {
  const input = e.target;
  if (input.type !== 'range' || !input.dataset.topic) return;
  const label = input.closest('.slider-module').querySelector('.slider-val');
  if (label) label.textContent = `${input.value}%`;
  clearTimeout(detailSliderTimer);
  detailSliderTimer = setTimeout(() => {
    publishLog(input.dataset.topic, { value: parseInt(input.value, 10) });
  }, 150);
});

window.addEventListener('load', recalcPower);

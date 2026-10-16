/**
 * BALLOON FUNRIDE - 3D Endless Jetpack Runner for start.ng
 * Pure static frontend using Three.js and Web Audio API
 */
import * as THREE from './vendor/three.module.js';

/* ==========================================================================
   1. START.NG BRIDGE & AUTHENTICATION
   ========================================================================== */
const START_NG = 'https://start.ng';
const API_URL = 'https://api.start.ng';

class StartNgBridge {
  constructor() {
    this.iframe = document.getElementById('startng-frame');
    this.currentUser = null;
    this.currentGuest = null;
    this.session = null;
    this.onProfileUpdate = null;
    this.gameName = 'balloon-funride';

    this.initSessionFromUrl();
    this.setupListeners();
  }

  initSessionFromUrl() {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const sessionToken = params.get('startng_session');
    if (sessionToken) {
      sessionStorage.setItem('startng_session', sessionToken);
      this.session = sessionToken;
      // Clean hash without reloading
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } else {
      this.session = sessionStorage.getItem('startng_session');
    }
  }

  setupListeners() {
    // Re-verify player when tab regains focus or visibility
    window.addEventListener('focus', () => this.fetchWhoAmI());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.fetchWhoAmI();
      }
    });

    // Handle sign-in button clicks
    const signInBtn = document.getElementById('player-sign-in');
    const lbSignInBtn = document.getElementById('btn-leaderboard-signin');
    const returnUrl = encodeURIComponent(window.location.origin + window.location.pathname);
    const signInUrl = `${START_NG}/?return_to=${returnUrl}`;

    if (signInBtn) signInBtn.href = signInUrl;
    if (lbSignInBtn) lbSignInBtn.href = signInUrl;
  }

  // Sends postMessage to start.ng connect iframe with origin verification
  async ask(message, replyType, timeoutMs = 4000) {
    if (!this.iframe) return null;
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, timeoutMs);

      const onMessage = (e) => {
        // Strict origin validation as mandated by start.ng specs
        if (e.origin !== START_NG) return;
        if (e.data?.type === replyType && e.data?.requestId === requestId) {
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          resolve(e.data);
        }
      };

      window.addEventListener('message', onMessage);
      try {
        this.iframe.contentWindow.postMessage({ ...message, requestId }, START_NG);
      } catch (err) {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(null);
      }
    });
  }

  async fetchWhoAmI() {
    let reply = null;
    try {
      reply = await this.ask({ type: 'startng:whoami' }, 'startng:user');
    } catch (e) {
      console.warn('start.ng connect frame postMessage failed, using local fallback:', e);
    }

    // Support HTTP game session fallback if frame didn't reply
    if (!reply && this.session) {
      try {
        const res = await fetch(`${API_URL}/games/${this.gameName}/player`, {
          headers: { Authorization: `Bearer ${this.session}` }
        });
        if (res.ok) {
          const userData = await res.json();
          reply = { user: userData };
        }
      } catch (err) {
        console.warn('HTTP session whoami fallback error:', err);
      }
    }

    const user = reply?.user || null;
    const guest = reply?.guest || null;
    this.currentUser = user;
    this.currentGuest = guest;

    const player = user ?? guest ?? this.getLocalFallbackPlayer();
    this.updateHUD(player, !!user);

    if (this.onProfileUpdate && player.style) {
      this.onProfileUpdate(player.style, player);
    }

    return player;
  }

  getLocalFallbackPlayer() {
    return {
      id: 0,
      name: 'Pilot',
      account: 'guest',
      face: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='24' fill='%23a55eea'/%3E%3Ccircle cx='24' cy='20' r='11' fill='%238d5524'/%3E%3Cpath d='M10 44c0-7.7 6.3-14 14-14s14 6.3 14 14' fill='%230c6e5a'/%3E%3C/svg%3E",
      style: {
        body: 'female',
        primaryColor: '#a55eea',
        secondaryColor: '#0c6e5a',
        skinColor: '#8d5524',
        hairColor: '#17120f',
        hair: 'braids',
        hat: 'crown',
        accessory: 'earrings'
      }
    };
  }

  updateHUD(player, isSignedIn) {
    const faceEl = document.getElementById('player-face');
    const nameEl = document.getElementById('player-name');
    const accountEl = document.getElementById('player-account');
    const signInBtn = document.getElementById('player-sign-in');
    const lbSignInBtn = document.getElementById('btn-leaderboard-signin');

    if (faceEl && player.face) faceEl.src = player.face;
    if (nameEl) nameEl.textContent = player.name || 'Guest Pilot';
    if (accountEl) accountEl.textContent = player.account ? `@${player.account}` : 'Guest';
    if (signInBtn) signInBtn.hidden = isSignedIn;
    if (lbSignInBtn) lbSignInBtn.hidden = isSignedIn;

    const styleStatusText = document.getElementById('style-status-text');
    if (styleStatusText) {
      styleStatusText.textContent = isSignedIn 
        ? `Synced with @${player.account}'s character` 
        : `Playing with standard guest outfit`;
    }
  }

  async submitScore(distance, coins) {
    const stats = {
      distance: Math.max(0, Math.floor(distance)),
      coins: Math.max(0, Math.floor(coins))
    };

    // 1. Post to start.ng connect iframe
    let res = await this.ask({ type: 'startng:score', stats }, 'startng:scoreSaved');

    // 2. HTTP session fallback if connect frame did not reply
    if (!res && this.session) {
      try {
        const httpRes = await fetch(`${API_URL}/games/${this.gameName}/scores`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.session}`
          },
          body: JSON.stringify({ stats })
        });
        if (httpRes.ok) {
          const data = await httpRes.json();
          res = { ok: true, result: data };
        }
      } catch (e) {
        console.warn('HTTP score submission failed:', e);
      }
    }

    return res;
  }

  async fetchLeaderboard(limit = 10) {
    // 1. Try connect frame
    let res = await this.ask({ type: 'startng:leaderboard', limit }, 'startng:leaderboardData');
    if (res?.entries) return res.entries;

    // 2. Fallback to public HTTP API
    try {
      const httpRes = await fetch(`${API_URL}/games/${this.gameName}/leaderboard?limit=${limit}`);
      if (httpRes.ok) {
        return await httpRes.json();
      }
    } catch (e) {
      console.warn('HTTP leaderboard fetch failed:', e);
    }

    // 3. Fallback mock leaderboard for offline local testing
    return [
      { rank: 1, name: 'AeroAce', stats: { distance: 3450, coins: 184 }, color: '#ff922b' },
      { rank: 2, name: 'CloudRider', stats: { distance: 2890, coins: 142 }, color: '#4dabf7' },
      { rank: 3, name: 'SkyCaptain', stats: { distance: 2150, coins: 95 }, color: '#20c997' },
      { rank: 4, name: 'Balloonist99', stats: { distance: 1680, coins: 76 }, color: '#f06595' },
      { rank: 5, name: 'GustWalker', stats: { distance: 1220, coins: 50 }, color: '#fab005' }
    ];
  }
}

/* ==========================================================================
   2. PROCEDURAL SOUND SYNTHESIZER (WEB AUDIO API)
   ========================================================================== */
class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.burnerNode = null;
    this.burnerGain = null;
    this.burnerFilter = null;
    this.isBurnerPlaying = false;
    this.bgmPlaying = false;
    this.bgmTimer = null;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.setupBurnerSound();
  }

  setupBurnerSound() {
    if (!this.ctx) return;
    // Create pink/brown noise buffer for realistic propane flame roar
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Brown noise filter
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    filter.Q.value = 3.0;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start();

    this.burnerNode = noise;
    this.burnerFilter = filter;
    this.burnerGain = gain;
  }

  setBurner(active) {
    if (!this.ctx || !this.burnerGain) return;
    const now = this.ctx.currentTime;
    if (this.muted) {
      this.burnerGain.gain.setValueAtTime(0.0001, now);
      return;
    }
    if (active) {
      this.burnerGain.gain.cancelScheduledValues(now);
      this.burnerGain.gain.setValueAtTime(this.burnerGain.gain.value, now);
      this.burnerGain.gain.exponentialRampToValueAtTime(0.35, now + 0.08);
      this.burnerFilter.frequency.exponentialRampToValueAtTime(850, now + 0.1);
    } else {
      this.burnerGain.gain.cancelScheduledValues(now);
      this.burnerGain.gain.setValueAtTime(this.burnerGain.gain.value, now);
      this.burnerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      this.burnerFilter.frequency.exponentialRampToValueAtTime(450, now + 0.12);
    }
  }

  playCoin() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, now); // B5
    osc.frequency.setValueAtTime(1318.51, now + 0.07); // E6

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  playBoostRing() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(960, now + 0.3);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(1600, now + 0.3);
    filter.Q.value = 4.0;

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.42);
  }

  playZapperHum() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110 + Math.random() * 40, now);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.16);
  }

  playCrash() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    // Noise explosion burst
    const bufferSize = this.ctx.sampleRate * 0.6;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.15));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 0.5);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);

    // Sub-bass thud
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.5);

    oscGain.gain.setValueAtTime(0.4, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.52);
  }

  startBGM() {
    if (this.bgmPlaying || !this.ctx) return;
    this.bgmPlaying = true;
    const chords = [
      [220.00, 261.63, 329.63], // Am
      [174.61, 220.00, 261.63], // F
      [261.63, 329.63, 392.00], // C
      [196.00, 246.94, 293.66]  // G
    ];
    let step = 0;

    const tick = () => {
      if (!this.bgmPlaying || this.muted) {
        this.bgmTimer = setTimeout(tick, 1000);
        return;
      }
      const now = this.ctx.currentTime;
      const currentChord = chords[step % chords.length];

      currentChord.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        gain.gain.setValueAtTime(0.025, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + 1.9);
      });

      step++;
      this.bgmTimer = setTimeout(tick, 1400);
    };

    tick();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted && this.burnerGain) {
      this.burnerGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    }
    return this.muted;
  }
}

/* ==========================================================================
   3. 3D HOT AIR BALLOON & DYNAMIC START.NG CHARACTER MESH
   ========================================================================== */
class BalloonMesh {
  constructor() {
    this.group = new THREE.Group();

    // Materials dictionary for real-time dynamic restyling
    this.materials = {
      primary: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 }),
      secondary: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 }),
      skin: new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 }),
      hair: new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }),
      wicker: new THREE.MeshStandardMaterial({ color: 0xb5804c, roughness: 0.9, metalness: 0.0 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x5c3826, roughness: 0.7, metalness: 0.1 }),
      rope: new THREE.MeshBasicMaterial({ color: 0xc4a482 }),
      sandbag: new THREE.MeshStandardMaterial({ color: 0xd9c298, roughness: 0.9 })
    };

    this.hairGroup = new THREE.Group();
    this.hatGroup = new THREE.Group();
    this.accessoryGroup = new THREE.Group();

    this.canopyCanvas = document.createElement('canvas');
    this.canopyCanvas.width = 512;
    this.canopyCanvas.height = 512;
    this.canopyTexture = new THREE.CanvasTexture(this.canopyCanvas);
    this.canopyMaterial = new THREE.MeshStandardMaterial({
      map: this.canopyTexture,
      roughness: 0.5,
      metalness: 0.05
    });

    this.buildHierarchy();
  }

  buildHierarchy() {
    // A. ENVELOPE / BALLOON CANOPY (Classic teardrop shape via LatheGeometry)
    const points = [];
    const segments = 18;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      // Parametric teardrop profile
      let radius, y;
      if (t < 0.6) {
        // Upper dome
        const angle = (t / 0.6) * (Math.PI / 2);
        radius = Math.sin(angle) * 3.2;
        y = 2.4 + Math.cos(angle) * 2.2;
      } else {
        // Taper down to throat
        const taperT = (t - 0.6) / 0.4;
        radius = 3.2 * (1 - taperT * 0.75);
        y = 2.4 - taperT * 3.6;
      }
      points.push(new THREE.Vector2(Math.max(0.1, radius), y));
    }

    const canopyGeo = new THREE.LatheGeometry(points, 32);
    this.canopyMesh = new THREE.Mesh(canopyGeo, this.canopyMaterial);
    this.canopyMesh.castShadow = true;
    this.group.add(this.canopyMesh);

    // Top Crown Cap
    const crownGeo = new THREE.CylinderGeometry(0.5, 0.9, 0.4, 16);
    const crownMesh = new THREE.Mesh(crownGeo, this.materials.brass);
    crownMesh.position.y = 4.7;
    this.group.add(crownMesh);

    // Burner Skirt / Throat Ring
    const skirtGeo = new THREE.TorusGeometry(0.85, 0.1, 8, 24);
    skirtGeo.rotateX(Math.PI / 2);
    const skirtMesh = new THREE.Mesh(skirtGeo, this.materials.leather);
    skirtMesh.position.y = -1.2;
    this.group.add(skirtMesh);

    // B. BURNER ASSEMBLY & DYNAMIC FLAME
    const burnerFrameGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.35, 12);
    const burnerFrame = new THREE.Mesh(burnerFrameGeo, this.materials.brass);
    burnerFrame.position.y = -1.7;
    this.group.add(burnerFrame);

    // Dual burner nozzles
    const nozzleGeo = new THREE.ConeGeometry(0.12, 0.25, 8);
    const nozzle1 = new THREE.Mesh(nozzleGeo, this.materials.brass);
    const nozzle2 = new THREE.Mesh(nozzleGeo, this.materials.brass);
    nozzle1.position.set(-0.16, -1.6, 0);
    nozzle2.position.set(0.16, -1.6, 0);
    nozzle1.rotation.x = Math.PI;
    nozzle2.rotation.x = Math.PI;
    this.group.add(nozzle1, nozzle2);

    // Dynamic 3D Burner Flame Mesh
    const flameGeo = new THREE.ConeGeometry(0.4, 1.2, 12);
    flameGeo.translate(0, 0.6, 0);
    this.flameMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8811,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending
    });
    this.flameMesh = new THREE.Mesh(flameGeo, this.flameMaterial);
    this.flameMesh.position.set(0, -1.5, 0);
    this.group.add(this.flameMesh);

    // Dynamic Burner Point Light
    this.burnerLight = new THREE.PointLight(0xff7722, 0, 8);
    this.burnerLight.position.set(0, -1.3, 0);
    this.group.add(this.burnerLight);

    // C. RIGGING ROPES
    const basketTopY = -2.8;
    const ropePoints = [
      new THREE.Vector3(-0.8, -1.2, 0.4), new THREE.Vector3(-0.65, basketTopY, 0.5),
      new THREE.Vector3(0.8, -1.2, 0.4), new THREE.Vector3(0.65, basketTopY, 0.5),
      new THREE.Vector3(-0.8, -1.2, -0.4), new THREE.Vector3(-0.65, basketTopY, -0.5),
      new THREE.Vector3(0.8, -1.2, -0.4), new THREE.Vector3(0.65, basketTopY, -0.5),
      new THREE.Vector3(0, -1.2, 0.6), new THREE.Vector3(0, basketTopY, 0.6)
    ];
    const ropeGeo = new THREE.BufferGeometry().setFromPoints(ropePoints);
    const ropes = new THREE.LineSegments(ropeGeo, this.materials.rope);
    this.group.add(ropes);

    // D. WICKER BASKET
    this.basketGroup = new THREE.Group();
    this.basketGroup.position.set(0, -3.2, 0);

    const basketBodyGeo = new THREE.BoxGeometry(1.3, 0.8, 1.1);
    const basketBody = new THREE.Mesh(basketBodyGeo, this.materials.wicker);
    basketBody.castShadow = true;
    basketBody.receiveShadow = true;
    this.basketGroup.add(basketBody);

    // Basket Leather Padded Rim
    const rimGeo = new THREE.BoxGeometry(1.38, 0.1, 1.18);
    rimGeo.translate(0, 0.4, 0);
    const rimMesh = new THREE.Mesh(rimGeo, this.materials.leather);
    this.basketGroup.add(rimMesh);

    // 4 Corner Ballast Sandbags
    const sandbagGeo = new THREE.SphereGeometry(0.16, 8, 8);
    sandbagGeo.scale(0.8, 1.2, 0.8);
    const sb1 = new THREE.Mesh(sandbagGeo, this.materials.sandbag);
    const sb2 = new THREE.Mesh(sandbagGeo, this.materials.sandbag);
    const sb3 = new THREE.Mesh(sandbagGeo, this.materials.sandbag);
    const sb4 = new THREE.Mesh(sandbagGeo, this.materials.sandbag);
    sb1.position.set(-0.65, 0.05, 0.55);
    sb2.position.set(0.65, 0.05, 0.55);
    sb3.position.set(-0.65, 0.05, -0.55);
    sb4.position.set(0.65, 0.05, -0.55);
    this.basketGroup.add(sb1, sb2, sb3, sb4);

    // E. 3D PLAYER CHARACTER (Inside the basket, visible to camera)
    this.characterGroup = new THREE.Group();
    this.characterGroup.position.set(0, 0.2, 0);

    // Torso (Shirt in primaryColor)
    const torsoGeo = new THREE.CylinderGeometry(0.24, 0.26, 0.55, 12);
    this.torsoMesh = new THREE.Mesh(torsoGeo, this.materials.primary);
    this.torsoMesh.position.y = 0.3;
    this.torsoMesh.castShadow = true;
    this.characterGroup.add(this.torsoMesh);

    // Pants (secondaryColor, inside basket)
    const legsGeo = new THREE.BoxGeometry(0.42, 0.4, 0.3);
    this.legsMesh = new THREE.Mesh(legsGeo, this.materials.secondary);
    this.legsMesh.position.y = -0.15;
    this.characterGroup.add(this.legsMesh);

    // Head (skinColor)
    const headGeo = new THREE.SphereGeometry(0.24, 16, 16);
    this.headMesh = new THREE.Mesh(headGeo, this.materials.skin);
    this.headMesh.position.y = 0.75;
    this.headMesh.castShadow = true;
    this.characterGroup.add(this.headMesh);

    // Stylized Face / Eyes
    const eyeGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeLeft = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeRight = new THREE.Mesh(eyeGeo, eyeMat);
    // Face pointing rightwards towards flight direction
    eyeLeft.position.set(0.2, 0.77, 0.09);
    eyeRight.position.set(0.2, 0.77, -0.09);
    this.characterGroup.add(eyeLeft, eyeRight);

    // Nose
    const noseGeo = new THREE.SphereGeometry(0.035, 6, 6);
    const nose = new THREE.Mesh(noseGeo, this.materials.skin);
    nose.position.set(0.24, 0.73, 0);
    this.characterGroup.add(nose);

    // Arms & Hands gripping the throttle cord and basket rim
    const armGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.38, 8);
    // Left arm forward onto rim
    const armLeft = new THREE.Mesh(armGeo, this.materials.primary);
    armLeft.position.set(0.25, 0.32, 0.2);
    armLeft.rotation.z = -Math.PI / 3;
    // Right arm reaching up to burner valve handle
    this.armRight = new THREE.Mesh(armGeo, this.materials.primary);
    this.armRight.position.set(0.12, 0.48, -0.12);
    this.armRight.rotation.z = Math.PI / 4;
    this.armRight.rotation.x = -Math.PI / 8;
    this.characterGroup.add(armLeft, this.armRight);

    // Hands
    const handGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const handLeft = new THREE.Mesh(handGeo, this.materials.skin);
    const handRight = new THREE.Mesh(handGeo, this.materials.skin);
    handLeft.position.set(0.42, 0.25, 0.2);
    handRight.position.set(0.18, 0.65, -0.14);
    this.characterGroup.add(handLeft, handRight);

    // Dynamic containers for Hair, Hat, Accessories
    this.characterGroup.add(this.hairGroup);
    this.characterGroup.add(this.hatGroup);
    this.characterGroup.add(this.accessoryGroup);

    this.basketGroup.add(this.characterGroup);
    this.group.add(this.basketGroup);

    // Initial default style
    this.applyStyle({
      body: 'female',
      primaryColor: '#a55eea',
      secondaryColor: '#0c6e5a',
      skinColor: '#8d5524',
      hairColor: '#17120f',
      hair: 'braids',
      hat: 'crown',
      accessory: 'earrings'
    });
  }

  // Dynamically re-colors and rebuilds accessories according to start.ng schema
  applyStyle(style) {
    if (!style) return;

    const primaryHex = style.primaryColor || '#a55eea';
    const secondaryHex = style.secondaryColor || '#0c6e5a';
    const skinHex = style.skinColor || '#8d5524';
    const hairHex = style.hairColor || '#17120f';

    // 1. Update standard materials
    this.materials.primary.color.set(primaryHex);
    this.materials.secondary.color.set(secondaryHex);
    this.materials.skin.color.set(skinHex);
    this.materials.hair.color.set(hairHex);

    // 2. Procedural Balloon Canopy Striped Texture
    const ctx = this.canopyCanvas.getContext('2d');
    const w = this.canopyCanvas.width;
    const h = this.canopyCanvas.height;
    const stripes = 16;
    const stripeW = w / stripes;

    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = (i % 2 === 0) ? primaryHex : secondaryHex;
      ctx.fillRect(i * stripeW, 0, stripeW, h);

      // Gold seam line
      ctx.fillStyle = '#ffdf78';
      ctx.fillRect(i * stripeW - 2, 0, 4, h);
    }

    // Horizontal decorative chevron band
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(0, h * 0.35, w, 24);
    ctx.fillRect(0, h * 0.55, w, 16);

    this.canopyTexture.needsUpdate = true;

    // 3. Hair Geometry
    this.hairGroup.clear();
    const hairStyle = style.hair || 'short';
    const hairY = 0.78;

    if (hairStyle === 'short') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.255, 12, 12), this.materials.hair);
      cap.position.set(-0.02, hairY + 0.04, 0);
      cap.scale.set(0.96, 0.96, 0.96);
      this.hairGroup.add(cap);
    } else if (hairStyle === 'afro') {
      const afro = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 14), this.materials.hair);
      afro.position.set(-0.02, hairY + 0.08, 0);
      this.hairGroup.add(afro);
    } else if (hairStyle === 'braids' || hairStyle === 'dreads') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), this.materials.hair);
      cap.position.set(0, hairY + 0.02, 0);
      this.hairGroup.add(cap);
      // Hanging braids
      const braidCount = hairStyle === 'braids' ? 6 : 8;
      for (let b = 0; b < braidCount; b++) {
        const angle = (b / braidCount) * Math.PI + Math.PI / 2;
        const braid = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.45, 6), this.materials.hair);
        braid.position.set(Math.cos(angle) * 0.22, hairY - 0.15, Math.sin(angle) * 0.22);
        this.hairGroup.add(braid);
      }
    } else if (hairStyle === 'bun') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), this.materials.hair);
      cap.position.set(0, hairY + 0.02, 0);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), this.materials.hair);
      bun.position.set(-0.08, hairY + 0.26, 0);
      this.hairGroup.add(cap, bun);
    } else if (hairStyle === 'ponytail') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), this.materials.hair);
      cap.position.set(0, hairY + 0.02, 0);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.03, 0.42, 6), this.materials.hair);
      tail.position.set(-0.25, hairY + 0.08, 0);
      tail.rotation.z = Math.PI / 3;
      this.hairGroup.add(cap, tail);
    }

    // 4. Hat Geometry
    this.hatGroup.clear();
    const hat = style.hat || 'none';
    if (hat === 'cap') {
      const capBase = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), this.materials.primary);
      capBase.position.set(0, hairY + 0.08, 0);
      const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 12, 1, false, 0, Math.PI), this.materials.secondary);
      visor.position.set(0.15, hairY + 0.04, 0);
      visor.rotation.z = -0.2;
      this.hatGroup.add(capBase, visor);
    } else if (hat === 'beanie') {
      const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 12), this.materials.secondary);
      beanie.position.set(-0.02, hairY + 0.1, 0);
      const pompom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), this.materials.primary);
      pompom.position.set(-0.04, hairY + 0.36, 0);
      this.hatGroup.add(beanie, pompom);
    } else if (hat === 'tophat') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16), this.materials.leather);
      brim.position.set(0, hairY + 0.22, 0);
      const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.38, 16), this.materials.leather);
      cylinder.position.set(0, hairY + 0.4, 0);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.08, 16), this.materials.primary);
      band.position.set(0, hairY + 0.26, 0);
      this.hatGroup.add(brim, cylinder, band);
    } else if (hat === 'crown') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.18, 8), this.materials.brass);
      crown.position.set(0, hairY + 0.28, 0);
      this.hatGroup.add(crown);
    }

    // 5. Accessories
    this.accessoryGroup.clear();
    const acc = style.accessory || 'none';
    if (acc === 'glasses') {
      const gRim = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12), this.materials.brass);
      const gRim2 = gRim.clone();
      gRim.position.set(0.22, hairY + 0.02, 0.1);
      gRim2.position.set(0.22, hairY + 0.02, -0.1);
      gRim.rotation.y = Math.PI / 2;
      gRim2.rotation.y = Math.PI / 2;
      this.accessoryGroup.add(gRim, gRim2);
    } else if (acc === 'earrings') {
      const ear1 = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 8), this.materials.brass);
      const ear2 = ear1.clone();
      ear1.position.set(0, hairY, 0.24);
      ear2.position.set(0, hairY, -0.24);
      this.accessoryGroup.add(ear1, ear2);
    } else if (acc === 'scarf') {
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 8, 16), this.materials.primary);
      scarf.position.set(0, 0.52, 0);
      scarf.rotation.x = Math.PI / 2;
      this.accessoryGroup.add(scarf);
    } else if (acc === 'backpack') {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.3), this.materials.leather);
      pack.position.set(-0.24, 0.35, 0);
      this.accessoryGroup.add(pack);
    } else if (acc === 'beard') {
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), this.materials.hair);
      beard.position.set(0.18, hairY - 0.12, 0);
      beard.scale.set(1.1, 0.8, 1.0);
      this.accessoryGroup.add(beard);
    }
  }

  update(dt, isBurnerOn, verticalVelocity) {
    // Dynamic tilt based on climbing or falling
    const targetTilt = isBurnerOn ? -0.16 : Math.min(0.14, verticalVelocity * -0.01);
    this.group.rotation.z += (targetTilt - this.group.rotation.z) * 6.0 * dt;

    // Gentle basket inertia sway
    const basketLag = (this.group.rotation.z - targetTilt) * 0.4;
    this.basketGroup.rotation.z = basketLag;

    // Burner flame animation & light
    if (isBurnerOn) {
      const flicker = 0.85 + Math.random() * 0.35;
      this.flameMaterial.opacity = 0.9;
      this.flameMesh.scale.set(flicker, 0.9 + Math.random() * 0.4, flicker);
      this.burnerLight.intensity = 2.4 * flicker;
      this.armRight.position.y = 0.52; // pulling burner valve
    } else {
      this.flameMaterial.opacity = 0.0;
      this.flameMesh.scale.set(0.01, 0.01, 0.01);
      this.burnerLight.intensity = 0.0;
      this.armRight.position.y = 0.48;
    }
  }
}

/* ==========================================================================
   4. PROCEDURAL ENVIRONMENT & OBSTACLES SYSTEM
   ========================================================================== */
class WorldManager {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
    this.coins = [];
    this.boostRings = [];
    this.particles = [];
    this.terrainChunks = [];

    this.spawnTimer = 0;
    this.nextSpawnDist = 20;

    this.buildStaticEnvironment();
  }

  buildStaticEnvironment() {
    // A. Sky & Ambient Lighting
    const hemiLight = new THREE.HemisphereLight(0xffeedd, 0x334466, 1.2);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff0dd, 1.4);
    dirLight.position.set(20, 40, 25);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    // B. Rolling Ground Chunks
    const groundGeo = new THREE.PlaneGeometry(160, 40, 16, 4);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3d7b38,
      roughness: 0.85,
      metalness: 0.05
    });

    for (let i = 0; i < 2; i++) {
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.position.set(i * 150, -1.0, 0);
      ground.receiveShadow = true;
      this.scene.add(ground);
      this.terrainChunks.push(ground);
    }

    // C. Decorative Distant Clouds
    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      transparent: true,
      opacity: 0.85
    });
    for (let c = 0; c < 14; c++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 2, 8, 8), cloudMat);
        puff.position.set(p * 2.2, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2);
        cloud.add(puff);
      }
      cloud.position.set(-60 + Math.random() * 180, 12 + Math.random() * 18, -15 - Math.random() * 20);
      cloud.userData.speed = 2.0 + Math.random() * 3.0;
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }

    // D. Visual Ceiling Jetstream Effect
    const ceilingLineGeo = new THREE.BufferGeometry();
    const cPoints = [];
    for (let i = 0; i < 60; i++) {
      cPoints.push(new THREE.Vector3(-40 + i * 3, 23.5, (Math.random() - 0.5) * 2));
    }
    ceilingLineGeo.setFromPoints(cPoints);
    const ceilingMat = new THREE.LineDashedMaterial({
      color: 0x88ccff,
      dashSize: 3,
      gapSize: 2,
      opacity: 0.5,
      transparent: true
    });
    this.ceilingStream = new THREE.Line(ceilingLineGeo, ceilingMat);
    this.ceilingStream.computeLineDistances();
    this.scene.add(this.ceilingStream);
  }

  // Spawns Laser Zappers, Storm Clouds, Steampunk Drones, Coins and Boost Rings
  updateSpawns(currentDistance, speed, dt) {
    if (currentDistance >= this.nextSpawnDist) {
      const spawnX = 65; // Offscreen to the right
      const rand = Math.random();

      if (rand < 0.36) {
        this.spawnZapper(spawnX);
      } else if (rand < 0.62) {
        this.spawnStormCloud(spawnX);
      } else if (rand < 0.82) {
        this.spawnDrone(spawnX);
      } else {
        this.spawnBoostRing(spawnX);
      }

      // Always spawn rewarding coin formations around hazards
      this.spawnCoinPattern(spawnX - 10);

      // Distance spacing decreases slightly as speed ramps up
      const spacing = Math.max(22, 45 - (speed * 0.4));
      this.nextSpawnDist = currentDistance + spacing;
    }
  }

  spawnZapper(x) {
    const group = new THREE.Group();
    group.userData.type = 'zapper';
    group.userData.cause = 'an electric laser zapper';

    const minY = 3.5;
    const maxY = 19.0;
    const isVertical = Math.random() > 0.4;
    const length = 5.0 + Math.random() * 3.5;

    let p1, p2;
    if (isVertical) {
      const centerY = minY + length / 2 + Math.random() * (maxY - minY - length);
      p1 = new THREE.Vector3(0, -length / 2, 0);
      p2 = new THREE.Vector3(0, length / 2, 0);
      group.position.set(x, centerY, 0);
    } else {
      const y = minY + Math.random() * (maxY - minY);
      p1 = new THREE.Vector3(-length / 2, 0, 0);
      p2 = new THREE.Vector3(length / 2, 0, 0);
      group.position.set(x, y, 0);
      group.rotation.z = (Math.random() - 0.5) * 0.8;
    }

    // Pylon poles
    const pylonGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.8, 12);
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.8, roughness: 0.2 });
    const cap1 = new THREE.Mesh(pylonGeo, pylonMat);
    const cap2 = new THREE.Mesh(pylonGeo, pylonMat);
    cap1.position.copy(p1);
    cap2.position.copy(p2);
    group.add(cap1, cap2);

    // Glowing hazard orbs
    const orbGeo = new THREE.SphereGeometry(0.4, 12, 12);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const orb1 = new THREE.Mesh(orbGeo, orbMat);
    const orb2 = new THREE.Mesh(orbGeo, orbMat);
    orb1.position.copy(p1);
    orb2.position.copy(p2);
    group.add(orb1, orb2);

    // Electric Laser Beam Line & Glow
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, length, 8);
    if (!isVertical) beamGeo.rotateZ(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x33ffff,
      transparent: true,
      opacity: 0.85
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    group.add(beamMesh);

    group.userData.beamMesh = beamMat;
    group.userData.p1 = p1;
    group.userData.p2 = p2;
    group.userData.radius = 0.65;
    group.userData.length = length;

    this.scene.add(group);
    this.obstacles.push(group);
  }

  spawnStormCloud(x) {
    const group = new THREE.Group();
    group.userData.type = 'storm';
    group.userData.cause = 'a thunderstorm lightning bolt';

    const cloudY = 16.0 + Math.random() * 4.0;
    group.position.set(x, cloudY, 0);

    // Dark ominous cloud puffs
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0x242838,
      roughness: 0.9,
      metalness: 0.1
    });

    for (let p = 0; p < 5; p++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random() * 0.8, 10, 10), cloudMat);
      puff.position.set((p - 2) * 1.6, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 1.0);
      group.add(puff);
    }

    // Downward lightning bolt line (flashes periodically)
    const strikePoints = [];
    let curY = 0;
    let curX = 0;
    while (curY > -14.0) {
      strikePoints.push(new THREE.Vector3(curX, curY, 0));
      curY -= 1.8;
      curX += (Math.random() - 0.5) * 1.4;
    }
    const boltGeo = new THREE.BufferGeometry().setFromPoints(strikePoints);
    const boltMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      linewidth: 3
    });
    const boltLine = new THREE.Line(boltGeo, boltMat);
    group.add(boltLine);

    group.userData.boltLine = boltLine;
    group.userData.boltMat = boltMat;
    group.userData.strikeTimer = 0.5 + Math.random() * 1.0;
    group.userData.isStriking = false;
    group.userData.strikePoints = strikePoints;

    this.scene.add(group);
    this.obstacles.push(group);
  }

  spawnDrone(x) {
    const group = new THREE.Group();
    group.userData.type = 'drone';
    group.userData.cause = 'a steampunk patrol drone';

    const y = 5.0 + Math.random() * 14.0;
    group.position.set(x, y, 0);
    group.userData.baseY = y;
    group.userData.time = Math.random() * 10;

    // Drone spherical brass body
    const droneMat = new THREE.MeshStandardMaterial({ color: 0x8a623a, metalness: 0.8, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 12), droneMat);
    group.add(body);

    // Red tracking lens
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), lensMat);
    lens.position.set(-0.7, 0, 0);
    group.add(lens);

    // Spinning top propeller
    const propMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9 });
    const prop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.25), propMat);
    prop.position.y = 0.9;
    group.add(prop);
    group.userData.prop = prop;

    this.scene.add(group);
    this.obstacles.push(group);
  }

  spawnCoinPattern(startX) {
    const patternType = Math.floor(Math.random() * 3);
    const coinCount = 5 + Math.floor(Math.random() * 5);
    const baseY = 4.0 + Math.random() * 12.0;

    for (let i = 0; i < coinCount; i++) {
      let x = startX + i * 2.2;
      let y = baseY;

      if (patternType === 0) {
        // Sine wave
        y = baseY + Math.sin(i * 0.7) * 3.0;
      } else if (patternType === 1) {
        // Ascending / descending ramp
        y = Math.min(21.0, Math.max(3.0, baseY + (i - coinCount / 2) * 1.5));
      }

      this.createCoin(x, y);
    }
  }

  createCoin(x, y) {
    const coinGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.12, 16);
    coinGeo.rotateZ(Math.PI / 2);
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.9,
      roughness: 0.2
    });
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.position.set(x, y, 0);
    this.scene.add(coin);
    this.coins.push(coin);
  }

  spawnBoostRing(x) {
    const ringGeo = new THREE.TorusGeometry(1.9, 0.16, 12, 24);
    ringGeo.rotateY(Math.PI / 2);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x00aacc,
      roughness: 0.2,
      metalness: 0.8
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const y = 5.0 + Math.random() * 12.0;
    ring.position.set(x, y, 0);

    this.scene.add(ring);
    this.boostRings.push(ring);
  }

  // Update positions, animations, and clean offscreen objects
  update(dt, speed, playerPos) {
    const moveX = speed * dt;

    // 1. Move Ground Chunks
    for (const ground of this.terrainChunks) {
      ground.position.x -= moveX;
      if (ground.position.x < -150) {
        ground.position.x += 300;
      }
    }

    // 2. Move Clouds Parallax
    for (const cloud of this.clouds) {
      cloud.position.x -= cloud.userData.speed * dt;
      if (cloud.position.x < -80) {
        cloud.position.x = 120 + Math.random() * 40;
        cloud.position.y = 12 + Math.random() * 18;
      }
    }

    // 3. Update Obstacles
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.position.x -= moveX;

      if (obs.userData.type === 'zapper') {
        // Pulse laser glow
        obs.userData.beamMesh.opacity = 0.65 + Math.sin(Date.now() * 0.02) * 0.35;
      } else if (obs.userData.type === 'storm') {
        obs.userData.strikeTimer -= dt;
        if (obs.userData.strikeTimer <= 0) {
          obs.userData.isStriking = true;
          obs.userData.boltMat.opacity = 0.95;
          setTimeout(() => {
            if (obs.userData.boltMat) obs.userData.boltMat.opacity = 0;
            obs.userData.isStriking = false;
          }, 180);
          obs.userData.strikeTimer = 1.2 + Math.random() * 2.0;
        }
      } else if (obs.userData.type === 'drone') {
        obs.userData.time += dt * 3.5;
        obs.position.y = obs.userData.baseY + Math.sin(obs.userData.time) * 2.8;
        if (obs.userData.prop) obs.userData.prop.rotation.y += 30 * dt;
      }

      // Remove when offscreen behind player
      if (obs.position.x < -25) {
        this.scene.remove(obs);
        this.obstacles.splice(i, 1);
      }
    }

    // 4. Update Coins
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      coin.position.x -= moveX;
      coin.rotation.y += 4.5 * dt;

      if (coin.position.x < -20) {
        this.scene.remove(coin);
        this.coins.splice(i, 1);
      }
    }

    // 5. Update Boost Rings
    for (let i = this.boostRings.length - 1; i >= 0; i--) {
      const ring = this.boostRings[i];
      ring.position.x -= moveX;
      ring.rotation.x += 2.0 * dt;

      if (ring.position.x < -20) {
        this.scene.remove(ring);
        this.boostRings.splice(i, 1);
      }
    }

    // 6. Update Sparks & Explosions Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.position.addScaledVector(p.velocity, dt);
      p.scale.multiplyScalar(0.96);
      if (p.life <= 0) {
        this.scene.remove(p);
        this.particles.splice(i, 1);
      }
    }
  }

  createSparks(pos, count = 12, color = 0xffd700) {
    const geo = new THREE.SphereGeometry(0.1, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      p.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 10
      );
      p.life = 0.4 + Math.random() * 0.3;
      this.scene.add(p);
      this.particles.push(p);
    }
  }

  reset() {
    for (const o of this.obstacles) this.scene.remove(o);
    for (const c of this.coins) this.scene.remove(c);
    for (const r of this.boostRings) this.scene.remove(r);
    for (const p of this.particles) this.scene.remove(p);
    this.obstacles = [];
    this.coins = [];
    this.boostRings = [];
    this.particles = [];
    this.nextSpawnDist = 20;
  }
}

/* ==========================================================================
   5. MAIN GAME ENGINE
   ========================================================================== */
class BalloonFunRideGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.state = 'MENU'; // MENU | PLAYING | GAMEOVER

    // Physics Constants
    this.gravity = -26.0;
    this.burnerThrust = 46.0;
    this.maxClimbSpeed = 16.0;
    this.maxFallSpeed = -15.0;
    this.groundY = 3.2;   // Basket skids along grass
    this.ceilingY = 22.0;  // Maximum sky altitude

    // Player Flight State
    this.playerX = 0;
    this.playerY = 10.0;
    this.verticalVelocity = 0;
    this.isBurnerFiring = false;
    this.isSkiddingOnGround = false;

    // Progression Stats
    this.distance = 0;
    this.coins = 0;
    this.baseSpeed = 16.0;
    this.currentSpeed = 16.0;
    this.speedMultiplier = 1.0;
    this.boostTimer = 0;

    // Subsystems
    this.startNg = new StartNgBridge();
    this.sfx = new SoundFX();

    this.initThree();
    this.initUI();
    this.initControls();

    // Hook start.ng profile updates into 3D balloon styling
    this.startNg.onProfileUpdate = (style) => {
      this.balloon.applyStyle(style);
    };

    // Load initial player info
    this.startNg.fetchWhoAmI();

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  initThree() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x76b6e4);
    this.scene.fog = new THREE.FogExp2(0x9bd0f5, 0.012);

    // Camera (Isometric side-scrolling perspective)
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(0, 13.5, 26);
    this.camera.lookAt(4, 11.5, 0);

    // Balloon & Character
    this.balloon = new BalloonMesh();
    this.balloon.group.position.set(this.playerX, this.playerY, 0);
    this.scene.add(this.balloon.group);

    // World & Obstacles Manager
    this.world = new WorldManager(this.scene);

    window.addEventListener('resize', () => this.onResize());
  }

  initUI() {
    this.startOverlay = document.getElementById('start-overlay');
    this.gameOverDialog = document.getElementById('game-over-dialog');
    this.btnStart = document.getElementById('btn-start');
    this.btnRestart = document.getElementById('btn-restart');
    this.btnMute = document.getElementById('btn-mute');
    this.muteIcon = document.getElementById('mute-icon');

    this.statDistance = document.getElementById('stat-distance');
    this.statCoins = document.getElementById('stat-coins');
    this.burnerBar = document.getElementById('burner-bar');
    this.burnerLabel = document.getElementById('burner-label');

    this.btnStart.addEventListener('click', () => this.startGame());
    this.btnRestart.addEventListener('click', () => this.restartGame());

    this.btnMute.addEventListener('click', () => {
      this.sfx.init();
      const isMuted = this.sfx.toggleMute();
      this.muteIcon.textContent = isMuted ? '🔇' : '🔊';
    });
  }

  initControls() {
    const handleBurnerStart = () => {
      this.sfx.init();
      this.sfx.startBGM();
      if (this.state === 'MENU') {
        this.startGame();
        return;
      }
      if (this.state === 'GAMEOVER') {
        this.restartGame();
        return;
      }
      this.isBurnerFiring = true;
      this.sfx.setBurner(true);
      if (this.burnerBar) this.burnerBar.style.width = '100%';
      if (this.burnerLabel) this.burnerLabel.textContent = '🔥 BURNER FIRING';
    };

    const handleBurnerStop = () => {
      this.isBurnerFiring = false;
      this.sfx.setBurner(false);
      if (this.burnerBar) this.burnerBar.style.width = '0%';
      if (this.burnerLabel) this.burnerLabel.textContent = 'BURNER READY';
    };

    // Keyboard (Spacebar)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        handleBurnerStart();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleBurnerStop();
      }
    });

    // Mouse & Touch Controls
    window.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#hud') || e.target.closest('.modal-card')) return;
      handleBurnerStart();
    });
    window.addEventListener('pointerup', () => handleBurnerStop());
    window.addEventListener('pointercancel', () => handleBurnerStop());
  }

  startGame() {
    this.sfx.init();
    this.sfx.startBGM();
    this.state = 'PLAYING';
    this.startOverlay.classList.remove('active');
    if (this.gameOverDialog.open) this.gameOverDialog.close();

    this.distance = 0;
    this.coins = 0;
    this.currentSpeed = this.baseSpeed;
    this.playerY = 10.0;
    this.verticalVelocity = 0;
    this.world.reset();
  }

  restartGame() {
    this.startGame();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  loop(timestamp) {
    requestAnimationFrame((t) => this.loop(t));

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    if (this.state === 'PLAYING') {
      this.updatePhysics(dt);
      this.updateCollisions();
      this.updateProgression(dt);
    } else if (this.state === 'MENU') {
      // Gentle floating animation while waiting at start menu
      this.playerY = 10.0 + Math.sin(timestamp * 0.002) * 0.8;
      this.balloon.group.position.y = this.playerY;
      this.balloon.update(dt, false, 0);
    }

    this.renderer.render(this.scene, this.camera);
  }

  updatePhysics(dt) {
    // Upward burner lift vs gentle gravity
    let accel = this.gravity;
    if (this.isBurnerFiring) {
      accel += this.burnerThrust;
    }

    this.verticalVelocity += accel * dt;
    this.verticalVelocity = Math.max(this.maxFallSpeed, Math.min(this.maxClimbSpeed, this.verticalVelocity));

    this.playerY += this.verticalVelocity * dt;

    // Ground Floor Skidding Constraint (Jetpack Joyride mechanic)
    if (this.playerY <= this.groundY) {
      this.playerY = this.groundY;
      this.verticalVelocity = 0;
      if (!this.isSkiddingOnGround) {
        this.isSkiddingOnGround = true;
        this.world.createSparks(new THREE.Vector3(this.playerX, this.groundY - 1.2, 0), 4, 0x88cc44);
      }
    } else {
      this.isSkiddingOnGround = false;
    }

    // Sky Ceiling Constraint
    if (this.playerY >= this.ceilingY) {
      this.playerY = this.ceilingY;
      this.verticalVelocity = Math.min(0, this.verticalVelocity);
    }

    this.balloon.group.position.y = this.playerY;
    this.balloon.update(dt, this.isBurnerFiring, this.verticalVelocity);

    // Smooth camera tracking
    this.camera.position.y += (13.5 + (this.playerY - 10) * 0.35 - this.camera.position.y) * 4 * dt;
  }

  updateProgression(dt) {
    // Speed increases progressively over distance
    const speedRamp = 1.0 + Math.min(1.2, this.distance / 1600);
    this.currentSpeed = this.baseSpeed * speedRamp * this.speedMultiplier;

    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) {
        this.speedMultiplier = 1.0;
      }
    }

    this.distance += this.currentSpeed * dt;
    this.world.updateSpawns(this.distance, this.currentSpeed, dt);
    this.world.update(dt, this.currentSpeed, this.balloon.group.position);

    // Update HUD stats
    if (this.statDistance) this.statDistance.textContent = Math.floor(this.distance);
    if (this.statCoins) this.statCoins.textContent = this.coins;
  }

  updateCollisions() {
    const balloonPos = this.balloon.group.position;
    // Envelope sphere at upper part, basket sphere at bottom
    const envelopeSphere = new THREE.Sphere(new THREE.Vector3(balloonPos.x, balloonPos.y + 2.0, 0), 2.7);
    const basketSphere = new THREE.Sphere(new THREE.Vector3(balloonPos.x, balloonPos.y - 3.2, 0), 1.2);

    // 1. Check Hazard Collisions
    for (const obs of this.world.obstacles) {
      let collided = false;

      if (obs.userData.type === 'zapper') {
        // Distance to line segment
        const obsPos = obs.position;
        const p1 = new THREE.Vector3().copy(obs.userData.p1).applyEuler(obs.rotation).add(obsPos);
        const p2 = new THREE.Vector3().copy(obs.userData.p2).applyEuler(obs.rotation).add(obsPos);

        const dEnv = this.distToSegment(envelopeSphere.center, p1, p2);
        const dBasket = this.distToSegment(basketSphere.center, p1, p2);

        if (dEnv < envelopeSphere.radius + obs.userData.radius || dBasket < basketSphere.radius + obs.userData.radius) {
          collided = true;
          this.sfx.playZapperHum();
        }
      } else if (obs.userData.type === 'storm') {
        if (obs.userData.isStriking) {
          // Lightning bolt active
          const dist = Math.abs(balloonPos.x - obs.position.x);
          if (dist < 2.8 && balloonPos.y < obs.position.y) {
            collided = true;
          }
        }
      } else if (obs.userData.type === 'drone') {
        const droneSphere = new THREE.Sphere(obs.position, 1.0);
        if (envelopeSphere.intersectsSphere(droneSphere) || basketSphere.intersectsSphere(droneSphere)) {
          collided = true;
        }
      }

      if (collided) {
        this.triggerGameOver(obs.userData.cause);
        return;
      }
    }

    // 2. Collect Coins
    for (let i = this.world.coins.length - 1; i >= 0; i--) {
      const coin = this.world.coins[i];
      const d1 = coin.position.distanceTo(envelopeSphere.center);
      const d2 = coin.position.distanceTo(basketSphere.center);

      if (d1 < envelopeSphere.radius + 0.6 || d2 < basketSphere.radius + 0.6) {
        this.coins++;
        this.sfx.playCoin();
        this.world.createSparks(coin.position, 8, 0xffe066);
        this.scene.remove(coin);
        this.world.coins.splice(i, 1);
      }
    }

    // 3. Boost Rings
    for (let i = this.world.boostRings.length - 1; i >= 0; i--) {
      const ring = this.world.boostRings[i];
      const dist = balloonPos.distanceTo(ring.position);

      if (dist < 2.5) {
        // Fly through ring
        this.distance += 45; // Jump forward
        this.coins += 5;
        this.speedMultiplier = 1.45;
        this.boostTimer = 2.0;
        this.sfx.playBoostRing();
        this.world.createSparks(ring.position, 18, 0x00e5ff);
        this.scene.remove(ring);
        this.world.boostRings.splice(i, 1);
      }
    }
  }

  distToSegment(p, a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const abLenSq = ab.lengthSq();
    if (abLenSq === 0) return ap.length();
    let t = ap.dot(ab) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const closest = new THREE.Vector3().copy(a).addScaledVector(ab, t);
    return p.distanceTo(closest);
  }

  triggerGameOver(cause) {
    this.state = 'GAMEOVER';
    this.isBurnerFiring = false;
    this.sfx.setBurner(false);
    this.sfx.playCrash();

    // Defeat explosion particles at balloon center
    this.world.createSparks(this.balloon.group.position, 32, 0xff4422);
    this.world.createSparks(this.balloon.group.position, 20, 0xffd700);

    // Populate Game Over Dialog
    const causeEl = document.getElementById('defeat-cause');
    const distEl = document.getElementById('summary-distance');
    const coinsEl = document.getElementById('summary-coins');
    const statusBanner = document.getElementById('save-status-banner');

    if (causeEl) causeEl.textContent = `You collided with ${cause}!`;
    if (distEl) distEl.textContent = Math.floor(this.distance);
    if (coinsEl) coinsEl.textContent = this.coins;

    if (this.gameOverDialog) {
      this.gameOverDialog.showModal();
    }

    // Submit score to start.ng
    this.submitAndShowLeaderboard();
  }

  async submitAndShowLeaderboard() {
    const statusBanner = document.getElementById('save-status-banner');
    const tbody = document.getElementById('leaderboard-tbody');

    if (statusBanner) {
      statusBanner.className = 'status-banner info';
      statusBanner.textContent = 'Submitting run to start.ng...';
    }

    try {
      const res = await this.startNg.submitScore(this.distance, this.coins);
      if (res?.result) {
        const saved = res.result;
        if (statusBanner) {
          statusBanner.className = 'status-banner improved';
          statusBanner.textContent = saved.improved
            ? `🎉 NEW BEST RUN! You ranked #${saved.rank} on start.ng!`
            : `Score saved! Best rank: #${saved.rank}`;
        }
      } else if (!this.startNg.currentUser) {
        if (statusBanner) {
          statusBanner.className = 'status-banner';
          statusBanner.textContent = 'Played as Guest. Sign in with start.ng to save to global leaderboard!';
        }
      }
    } catch (err) {
      console.warn('Score submission notice:', err);
    }

    // Load leaderboard entries
    const entries = await this.startNg.fetchLeaderboard(10);
    if (tbody && entries) {
      tbody.innerHTML = '';
      entries.forEach((e) => {
        const tr = document.createElement('tr');
        if (this.startNg.currentUser && e.player_id === this.startNg.currentUser.id) {
          tr.className = 'current-player';
        }
        tr.innerHTML = `
          <td class="col-rank">#${e.rank}</td>
          <td class="col-pilot">${e.name || 'Anonymous Pilot'}</td>
          <td class="col-dist">${e.stats?.distance ?? e.score ?? 0}m</td>
          <td class="col-coins">${e.stats?.coins ?? 0}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }
}

// Instantiate game on page load
window.addEventListener('DOMContentLoaded', () => {
  new BalloonFunRideGame();
});

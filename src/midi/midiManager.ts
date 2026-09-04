import { engine } from "../audio/engine";
import type { DeckId, MidiBinding, MidiTarget } from "../audio/types";
import { settings } from "../settings/store";

const STORAGE_KEY = "crhis.midi.bindings.v1";

type MidiListener = () => void;
type LearnListener = (binding: Omit<MidiBinding, "target">) => void;

class MidiManager {
  private access: MIDIAccess | null = null;
  private outputs: MIDIOutput[] = [];
  private bindings: MidiBinding[] = [];
  private learning: MidiTarget | null = null;
  private devices: string[] = [];
  private lastMessage = "";
  private listeners = new Set<MidiListener>();
  private learnWaiters = new Set<LearnListener>();
  private jogMemory = new Map<string, number>();
  private feedbackState = new Map<string, number>();
  private takeover = new Map<string, boolean>();
  private feedbackHooked = false;
  private msgCount = 0;
  private lastEmit = 0;
  private lastAction = "";
  /** Últimos controles distintos vistos (para mapear / mandar el mapa). */
  private seen: { type: "cc" | "note"; channel: number; data: number; value: number; count: number }[] = [];
  private state = {
    devices: [] as string[],
    bindings: [] as MidiBinding[],
    learning: null as MidiTarget | null,
    lastMessage: "",
    lastAction: "",
    wizardRemaining: 0,
    msgCount: 0,
    seen: [] as { type: "cc" | "note"; channel: number; data: number; value: number; count: number }[],
    supported: Boolean(typeof navigator !== "undefined" && navigator.requestMIDIAccess),
  };

  private starting = false;

  async start() {
    this.bindings = loadBindings();
    if (!navigator.requestMIDIAccess) {
      this.lastMessage = "Este sistema no expone Web MIDI.";
      console.warn("[MIDI] navigator.requestMIDIAccess no existe");
      this.emit();
      return;
    }
    // Si ya hay acceso, sólo re-enumeramos (botón "Reescanear").
    if (this.access) {
      this.hook();
      return;
    }
    if (this.starting) return; // evita doble llamada (StrictMode) en paralelo
    this.starting = true;
    try {
      console.log("[MIDI] pidiendo acceso…");
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.starting = false;
      this.lastMessage = `Acceso MIDI rechazado: ${(err as Error)?.message ?? err}`;
      console.error("[MIDI] requestMIDIAccess falló:", err);
      this.emit();
      return;
    }
    this.starting = false;
    this.hook();
    this.access.onstatechange = (e) => {
      const p = (e as MIDIConnectionEvent).port;
      console.log("[MIDI] statechange:", p?.type, p?.name, p?.state, p?.connection);
      this.hook();
    };
    if (!this.feedbackHooked) {
      this.feedbackHooked = true;
      engine.subscribe(() => this.sendFeedback());
    }
    this.emit();

    // Chromium/Electron a veces devuelve `inputs` vacío en el primer
    // requestMIDIAccess aunque el aparato esté conectado; re-enumeramos unas
    // cuantas veces durante los primeros ~4 s.
    let tries = 0;
    const poll = setInterval(() => {
      tries += 1;
      if (!this.access || tries > 8) {
        clearInterval(poll);
        return;
      }
      if (this.access.inputs.size !== this.devices.length) this.hook();
    }, 500);
  }

  /** Vuelve a pedir/enumerar dispositivos (botón en el panel). */
  rescan() {
    void this.start();
  }

  getState() {
    return this.state;
  }

  subscribe(fn: MidiListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  beginLearn(target: MidiTarget) {
    this.learning = target;
    this.lastMessage = `Mueve el control para ${labelFor(target)}`;
    this.emit();
  }

  /** Asistente: recorre los controles esenciales, uno por uno. Pulsa/mueve cada
   *  control físico y avanza solo. "Saltar" pasa al siguiente. */
  private wizardQueue: MidiTarget[] = [];
  private wizardActive = false;

  startWizard() {
    this.wizardActive = true;
    this.wizardQueue = [
      "deck.a.play", "deck.a.cue", "deck.a.sync", "deck.a.volume", "deck.a.pitch", "deck.a.jog",
      "deck.a.eqHigh", "deck.a.eqMid", "deck.a.eqLow", "deck.a.filter", "deck.a.load",
      "deck.a.hotcue.0", "deck.a.hotcue.1", "deck.a.hotcue.2", "deck.a.hotcue.3",
      "deck.b.play", "deck.b.cue", "deck.b.sync", "deck.b.volume", "deck.b.pitch", "deck.b.jog",
      "deck.b.eqHigh", "deck.b.eqMid", "deck.b.eqLow", "deck.b.filter", "deck.b.load",
      "deck.b.hotcue.0", "deck.b.hotcue.1", "deck.b.hotcue.2", "deck.b.hotcue.3",
      "mixer.crossfader", "mixer.master", "library.up", "library.down", "preview.toggle",
    ];
    this.nextWizard();
  }

  skipWizard() {
    if (this.wizardActive) this.nextWizard();
  }

  stopWizard() {
    this.wizardActive = false;
    this.wizardQueue = [];
    this.learning = null;
    this.lastMessage = "Asistente detenido.";
    this.emit();
  }

  private nextWizard() {
    const t = this.wizardQueue.shift();
    if (!t) {
      this.wizardActive = false;
      this.learning = null;
      this.lastMessage = "Mapeo completo ✓  — pulsa Guardar preset si quieres reusarlo.";
      this.emit();
      return;
    }
    this.beginLearn(t);
  }

  get wizardRemaining() {
    return this.wizardActive ? this.wizardQueue.length + 1 : 0;
  }

  cancelLearn() {
    this.learning = null;
    this.wizardActive = false;
    this.wizardQueue = [];
    this.emit();
  }

  clearBinding(target: MidiTarget) {
    this.bindings = this.bindings.filter((b) => b.target !== target);
    saveBindings(this.bindings);
    this.emit();
  }

  clearAll() {
    this.bindings = [];
    saveBindings(this.bindings);
    this.emit();
  }

  applyPreset(bindings: MidiBinding[], label: string) {
    this.bindings = bindings;
    saveBindings(this.bindings);
    this.lastMessage = `Preset aplicado: ${label}`;
    this.emit();
  }

  waitForControl(): Promise<Omit<MidiBinding, "target">> {
    return new Promise((resolve) => {
      const once: LearnListener = (binding) => {
        this.learnWaiters.delete(once);
        resolve(binding);
      };
      this.learnWaiters.add(once);
    });
  }

  private hook() {
    if (!this.access) return;
    this.devices = [];
    for (const input of this.access.inputs.values()) {
      this.devices.push(input.name || input.id);
      input.onmidimessage = (event) => this.onMessage(event);
    }
    this.outputs = [...this.access.outputs.values()];
    console.log(
      `[MIDI] enumerado: ${this.access.inputs.size} entrada(s), ${this.access.outputs.size} salida(s) →`,
      this.devices,
    );
    this.lastMessage = this.devices.length
      ? `${this.devices.length} controladora(s): ${this.devices.join(", ")} · ${this.outputs.length} salida(s) LED`
      : "Sin controladoras MIDI. Revisa que esté encendida, en modo MIDI (no HID/Serato) y pulsa Reescanear.";
    this.feedbackState.clear();
    this.takeover.clear();
    this.sendFeedback();
    this.emit();
  }

  /** Enciende/apaga los LEDs de la controladora según el estado del motor. */
  private sendFeedback() {
    if (!this.outputs.length || !this.bindings.length) return;
    const snap = engine.snapshot();
    for (const binding of this.bindings) {
      const lit = feedbackValueFor(binding.target, snap);
      if (lit === null) continue;
      const key = binding.target;
      if (this.feedbackState.get(key) === lit) continue;
      this.feedbackState.set(key, lit);
      this.sendMidi(binding, lit ? 127 : 0);
    }
  }

  private sendMidi(binding: MidiBinding, velocity: number) {
    const status = (binding.type === "cc" ? 0xb0 : 0x90) | ((binding.channel - 1) & 0x0f);
    const msg = [status, binding.data & 0x7f, velocity & 0x7f];
    for (const out of this.outputs) {
      try {
        out.send(msg);
      } catch {
        /* salida no disponible */
      }
    }
  }

  /** Soft-takeover: no aplica el CC hasta que el mando "alcanza" el valor de la
   *  app; a partir de ahí queda enganchado. Devuelve true si hay que aplicar.
   *  Desactivado por defecto (setting `midiPickup`) — al principio confunde
   *  porque los faders "no responden" hasta cruzar la posición en pantalla. */
  private softTakeover(target: MidiTarget, incoming: number): boolean {
    if (!settings.get().midiPickup) return true; // modo "agarre inmediato"
    const app = appValueFor(target);
    if (app === null) return true;
    if (this.takeover.get(target)) return true;
    if (Math.abs(incoming - app) <= 0.04) {
      this.takeover.set(target, true);
      return true;
    }
    return false;
  }

  private onMessage(event: MIDIMessageEvent) {
    const data = event.data;
    if (!data || data.length < 2) return;
    const status = data[0]!;
    const d1 = data[1]!;
    const d2 = data[2] ?? 0;
    const typeNibble = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    // CC (0xB0), nota (0x90/0x80) y pitch-bend (0xE0, común en faders de pitch y
    // jogs de algunas controladoras — se trata como CC usando el byte alto).
    let kind: "cc" | "note" | null = null;
    let ctrl = d1;
    let val = d2;
    if (typeNibble === 0xb0) kind = "cc";
    else if (typeNibble === 0x90 || typeNibble === 0x80) kind = "note";
    else if (typeNibble === 0xe0) {
      kind = "cc";
      ctrl = 128; // pseudo-CC para pitch-bend
      val = d2; // MSB (0..127)
    }
    if (!kind) return;
    if (kind === "note" && typeNibble === 0x80) val = 0; // note-off = release

    this.msgCount += 1;
    const incoming = { type: kind, channel, data: ctrl } as const;
    this.lastMessage = `${(typeNibble === 0xe0 ? "PB" : kind.toUpperCase())} ch${channel} #${ctrl} → ${val} · total ${this.msgCount}`;

    // Registro de controles distintos (para mapear a ojo o mandarme el mapa).
    const hit = this.seen.find((s) => s.type === kind && s.channel === channel && s.data === ctrl);
    if (hit) {
      hit.value = val;
      hit.count += 1;
    } else {
      this.seen.unshift({ type: kind, channel, data: ctrl, value: val, count: 1 });
      if (this.seen.length > 24) this.seen.pop();
    }

    // Refresca el panel (limitado a ~10/s para no saturar con jogs/faders).
    const now = Date.now();
    if (!this.learning && now - this.lastEmit > 100) {
      this.lastEmit = now;
      this.emit();
    }

    if (this.learning) {
      this.bindings = [
        ...this.bindings.filter((b) => b.target !== this.learning),
        { target: this.learning, ...incoming },
      ];
      saveBindings(this.bindings);
      this.learning = null;
      this.emit();
      if (this.wizardActive) window.setTimeout(() => this.nextWizard(), 300);
      return;
    }

    this.learnWaiters.forEach((fn) => fn(incoming));

    const matches = this.bindings.filter(
      (b) => b.type === incoming.type && b.channel === incoming.channel && b.data === incoming.data,
    );
    this.lastAction = matches.length
      ? `→ ${matches.map((m) => labelFor(m.target)).join(", ")}`
      : "· sin asignar (usa Aprender)";
    for (const binding of matches) {
      this.dispatch(binding.target, val, incoming);
    }
  }

  private dispatch(target: MidiTarget, value: number, incoming: Omit<MidiBinding, "target">) {
    const amount = value / 127;
    const pressed = value > 0;

    if (target === "mixer.crossfader") {
      if (this.softTakeover(target, amount)) engine.setCrossfader(amount);
      return;
    }
    if (target === "mixer.master") {
      if (this.softTakeover(target, amount)) engine.setMaster(amount);
      return;
    }
    if (target === "library.up" && pressed) {
      window.dispatchEvent(new CustomEvent("crhis:library-move", { detail: -1 }));
      return;
    }
    if (target === "library.down" && pressed) {
      window.dispatchEvent(new CustomEvent("crhis:library-move", { detail: 1 }));
      return;
    }
    if (target === "preview.toggle" && pressed) {
      window.dispatchEvent(new CustomEvent("crhis:preview-toggle"));
      return;
    }

    const [, deckRaw, action, extra] = target.split(".");
    const deck = deckRaw as DeckId;
    if (deck !== "a" && deck !== "b") return;

    switch (action) {
      case "play":
        if (pressed) engine.toggle(deck);
        break;
      case "cue":
        engine.cue(deck, pressed);
        break;
      case "sync":
        if (pressed) engine.sync(deck);
        break;
      case "pitch":
        if (this.softTakeover(target, amount)) engine.setPitch(deck, amount);
        break;
      case "load":
        if (pressed) window.dispatchEvent(new CustomEvent("crhis:load-selected", { detail: deck }));
        break;
      case "jog": {
        const key = `${incoming.type}:${incoming.channel}:${incoming.data}`;
        const prev = this.jogMemory.get(key);
        this.jogMemory.set(key, value);
        if (prev === undefined) break;
        let delta = value - prev;
        if (delta > 64) delta -= 128;
        if (delta < -64) delta += 128;
        engine.jog(deck, delta * 0.035);
        break;
      }
      case "volume":
        if (this.softTakeover(target, amount)) engine.setVolume(deck, amount);
        break;
      case "gain":
        if (this.softTakeover(target, amount)) engine.setGain(deck, amount);
        break;
      case "eqLow":
        if (this.softTakeover(target, amount)) engine.setEq(deck, "low", amount);
        break;
      case "eqMid":
        if (this.softTakeover(target, amount)) engine.setEq(deck, "mid", amount);
        break;
      case "eqHigh":
        if (this.softTakeover(target, amount)) engine.setEq(deck, "high", amount);
        break;
      case "filter":
        if (this.softTakeover(target, amount)) engine.setFilter(deck, amount);
        break;
      case "hotcue":
        if (pressed && extra) engine.hotCue(deck, Number(extra));
        break;
      default:
        break;
    }
  }

  private emit() {
    this.state = {
      devices: this.devices,
      bindings: this.bindings,
      learning: this.learning,
      lastMessage: this.lastMessage,
      lastAction: this.lastAction,
      wizardRemaining: this.wizardRemaining,
      msgCount: this.msgCount,
      seen: [...this.seen],
      supported: Boolean(typeof navigator !== "undefined" && navigator.requestMIDIAccess),
    };
    this.listeners.forEach((fn) => fn());
  }
}

function loadBindings(): MidiBinding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MidiBinding[]) : [];
  } catch {
    return [];
  }
}

function saveBindings(bindings: MidiBinding[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

/** Valor 0..1 actual en la app para un target continuo (para soft-takeover). */
function appValueFor(target: MidiTarget): number | null {
  const snap = engine.snapshot();
  if (target === "mixer.crossfader") return snap.mixer.crossfader;
  if (target === "mixer.master") return snap.mixer.master;
  const [, deckRaw, action] = target.split(".");
  const deck = deckRaw as DeckId;
  if (deck !== "a" && deck !== "b") return null;
  const d = snap.decks[deck];
  switch (action) {
    case "volume":
      return d.volume;
    case "gain":
      return d.gain;
    case "eqLow":
      return d.eq.low;
    case "eqMid":
      return d.eq.mid;
    case "eqHigh":
      return d.eq.high;
    case "filter":
      return d.filter;
    case "pitch":
      return null; // el pitch se aplica absoluto; sin pickup
    default:
      return null;
  }
}

/** 1 = LED encendido, 0 = apagado, null = target sin feedback. */
function feedbackValueFor(target: MidiTarget, snap: ReturnType<typeof engine.snapshot>): number | null {
  const [, deckRaw, action, extra] = target.split(".");
  const deck = deckRaw as DeckId;
  if (deck !== "a" && deck !== "b") return null;
  const d = snap.decks[deck];
  switch (action) {
    case "play":
      return d.playing ? 1 : 0;
    case "cue":
      return d.loaded && !d.playing ? 1 : 0;
    case "sync":
      return d.synced ? 1 : 0;
    case "hotcue":
      return extra && d.hotCues[Number(extra)] ? 1 : 0;
    default:
      return null;
  }
}

export function labelFor(target: MidiTarget) {
  const map: Record<string, string> = {
    "deck.a.play": "Deck A · Play",
    "deck.a.cue": "Deck A · Cue",
    "deck.a.sync": "Deck A · Sync",
    "deck.a.pitch": "Deck A · Pitch",
    "deck.a.jog": "Deck A · Jog",
    "deck.a.volume": "Deck A · Volumen",
    "deck.a.gain": "Deck A · Gain",
    "deck.a.eqLow": "Deck A · EQ Low",
    "deck.a.eqMid": "Deck A · EQ Mid",
    "deck.a.eqHigh": "Deck A · EQ High",
    "deck.a.filter": "Deck A · Filtro",
    "deck.b.play": "Deck B · Play",
    "deck.b.cue": "Deck B · Cue",
    "deck.b.sync": "Deck B · Sync",
    "deck.b.pitch": "Deck B · Pitch",
    "deck.b.jog": "Deck B · Jog",
    "deck.b.volume": "Deck B · Volumen",
    "deck.b.gain": "Deck B · Gain",
    "deck.b.eqLow": "Deck B · EQ Low",
    "deck.b.eqMid": "Deck B · EQ Mid",
    "deck.b.eqHigh": "Deck B · EQ High",
    "deck.b.filter": "Deck B · Filtro",
    "deck.a.load": "Deck A · Load",
    "deck.b.load": "Deck B · Load",
    "mixer.crossfader": "Crossfader",
    "mixer.master": "Master",
    "library.up": "Biblioteca · Arriba",
    "library.down": "Biblioteca · Abajo",
    "preview.toggle": "Preview",
  };
  if (map[target]) return map[target];
  const cue = /^deck\.(a|b)\.hotcue\.(\d)$/.exec(target);
  if (cue) return `Deck ${cue[1]!.toUpperCase()} · Hot Cue ${Number(cue[2]) + 1}`;
  return target;
}

export const midiTargets: MidiTarget[] = [
  "deck.a.play",
  "deck.a.cue",
  "deck.a.sync",
  "deck.a.pitch",
  "deck.a.jog",
  "deck.a.volume",
  "deck.a.gain",
  "deck.a.eqLow",
  "deck.a.eqMid",
  "deck.a.eqHigh",
  "deck.a.filter",
  "deck.a.load",
  "deck.a.hotcue.0",
  "deck.a.hotcue.1",
  "deck.a.hotcue.2",
  "deck.a.hotcue.3",
  "deck.b.play",
  "deck.b.cue",
  "deck.b.sync",
  "deck.b.pitch",
  "deck.b.jog",
  "deck.b.volume",
  "deck.b.gain",
  "deck.b.eqLow",
  "deck.b.eqMid",
  "deck.b.eqHigh",
  "deck.b.filter",
  "deck.b.load",
  "deck.b.hotcue.0",
  "deck.b.hotcue.1",
  "deck.b.hotcue.2",
  "deck.b.hotcue.3",
  "mixer.crossfader",
  "mixer.master",
  "library.up",
  "library.down",
  "preview.toggle",
];

export const midi = new MidiManager();

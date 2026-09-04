export type JogMode = "vinyl" | "cdj";
export type PitchRange = 8 | 16 | 50;
export type LayoutMode = "full" | "waves" | "library" | "perform";

export type AppSettings = {
  jogMode: JogMode;
  jogSensitivity: number;
  quantize: boolean;
  pitchRange: PitchRange;
  xfaderCurve: number;
  autoGain: boolean;
  layout: LayoutMode;
  midiPickup: boolean;
};

const KEY = "crhis.settings.v1";

const DEFAULTS: AppSettings = {
  jogMode: "cdj",
  jogSensitivity: 0.7,
  quantize: true,
  pitchRange: 8,
  xfaderCurve: 0.35,
  autoGain: true,
  layout: "full",
  midiPickup: false,
};

type Listener = (settings: AppSettings) => void;

class SettingsStore {
  private value: AppSettings;
  private listeners = new Set<Listener>();

  constructor() {
    this.value = load();
  }

  get() {
    return this.value;
  }

  set(partial: Partial<AppSettings>) {
    this.value = { ...this.value, ...partial };
    localStorage.setItem(KEY, JSON.stringify(this.value));
    this.listeners.forEach((fn) => fn(this.value));
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as AppSettings) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export const settings = new SettingsStore();

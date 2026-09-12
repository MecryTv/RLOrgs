/** Oberflaechentoene, im Browser erzeugt statt als Datei geladen. */
import { prefs } from "./Prefs.js";
/* ----------------------------------------------------------
   Oberflächentöne (synthetisiert)
   ---------------------------------------------------------- */
export const audio = { ctx: null, last: 0 };
export function tone(frequency, duration, peak, type) {
    if (!prefs.sound || prefs.volume <= 0)
        return;
    // exponentialRampToValueAtTime kommt mit 0 nicht klar - deshalb steht oben
    // die Prüfung auf volume <= 0 und nicht bloß ein Faktor hier unten.
    const level = peak * (prefs.volume / 100);
    try {
        if (!audio.ctx)
            audio.ctx = new AudioContext();
        if (audio.ctx.state === "suspended")
            void audio.ctx.resume();
        const start = audio.ctx.currentTime;
        const oscillator = audio.ctx.createOscillator();
        const gain = audio.ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, start + duration);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain).connect(audio.ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
    }
    catch {
        // Kein AudioContext, keine Töne - die Oberfläche funktioniert weiter.
        prefs.sound = false;
    }
}
export function hoverSound() {
    const now = Date.now();
    if (now - audio.last < 90)
        return;
    audio.last = now;
    tone(720, 0.07, 0.018, "triangle");
}
export function clickSound(kind) {
    tone(kind === "warm" ? 300 : 480, 0.13, 0.05, "sawtooth");
    window.setTimeout(() => tone(kind === "warm" ? 460 : 760, 0.16, 0.035, "sine"), 60);
}

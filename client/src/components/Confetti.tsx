import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

const COLORS = ["#38bdf8", "#facc15", "#f472b6", "#4ade80", "#f97316", "#a78bfa", "#ffffff"];
const PIECES = 90;

/** A one-shot burst over the whole screen; removes itself after a few seconds and never blocks taps. */
export function Confetti() {
  const [done, setDone] = useState(false);
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        drift: (Math.random() - 0.5) * 240,
        delay: Math.random() * 0.6,
        duration: 2.4 + Math.random() * 1.6,
        rotate: (Math.random() - 0.5) * 900,
        size: 6 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
      })),
    [],
  );
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 4800);
    return () => clearTimeout(t);
  }, []);
  if (done) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0 block rounded-sm"
          style={{ left: `${p.left}%`, width: p.size, height: p.size * 0.6, backgroundColor: p.color }}
          initial={{ y: -20, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: "105vh", x: p.drift, rotate: p.rotate, opacity: [1, 1, 0.8] }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}

/** Plays the confetti once per race per device, for every co-winner who opens the final standings. */
export function useWinnerConfetti(raceId: string, isWinner: boolean): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isWinner) return;
    const key = `dnd:confetti:${raceId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // Storage blocked: celebrate anyway.
    }
    setShow(true);
  }, [raceId, isWinner]);
  return show;
}

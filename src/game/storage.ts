export interface ScoreEntry {
  name: string;
  score: number;
  at: number;
}

const SCORES_KEY = "neonswarm.highscores.v1";
const MUTED_KEY = "neonswarm.muted";
export const MAX_SCORES = 8;

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ScoreEntry =>
          e && typeof e.name === "string" && typeof e.score === "number" && e.score >= 0
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch {
    return [];
  }
}

export function saveScore(name: string, score: number): ScoreEntry[] {
  const clean = (name || "ACE").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "ACE";
  const list = [...loadScores(), { name: clean, score, at: Date.now() }]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SCORES);
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  return list;
}

export function qualifiesForBoard(score: number, list: ScoreEntry[]): boolean {
  if (score <= 0) return false;
  if (list.length < MAX_SCORES) return true;
  return score > list[list.length - 1].score;
}

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

# Neon Swarm

Neon Swarm is a fast-paced neon arcade shooter built with React, TypeScript, Vite, and Canvas 2D.  
Defend the sector, chain eliminations for combo multipliers, and climb the local Hall of Fame.

## Features

- Responsive desktop and touch controls
- 60 FPS-oriented Canvas 2D gameplay loop
- Multiple enemy behaviors (chaser, wanderer, weaver, splitter)
- Combo multiplier and score-driven survival gameplay
- Pause, restart, and mute controls
- Local high-score board (top 8) saved in browser storage

## Tech Stack

- React 19
- TypeScript
- Vite 7
- Tailwind CSS 4

## Getting Started

### Prerequisites

- Node.js 18+ (recommended)
- npm

### Install

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Deployment (GitLab Pages)

The pipeline in `.gitlab-ci.yml` builds the app with Vite and publishes `dist/` to GitLab Pages on every push to the default branch.

The site will be available at `https://<namespace>.gitlab.io/<project>/`. No extra settings are required — Vite is configured with `base: "./"` and `vite-plugin-singlefile`, so all JS/CSS is inlined into a single `index.html` that works at any subpath (and even from `file://`).

## Controls

### Desktop

- **Move:** `W A S D` (arrow keys also work)
- **Aim:** Mouse
- **Fire:** Mouse click or `Space`
- **Pause/Resume:** `P` or `Esc`
- **Mute:** `M`
- **Quick restart (post-game):** `R`

### Touch

- **Left thumb:** Movement stick
- **Right thumb:** Aim + autofire stick
- On-screen controls are shown in-game

## Scoring

- Eliminate enemies to gain points
- Maintain kill streaks to increase combo multiplier
- Final run summary includes score, kills, survival time, and max combo

## Project Structure

```text
src/
  components/   # Menu, HUD, overlays
  game/         # Core engine, audio, sprites, storage
  utils/        # Utility helpers
```

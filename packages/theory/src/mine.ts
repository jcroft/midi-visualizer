// Moves you named yourself. The miner appends the unnamed patterns it finds in your
// recordings here; rename them freely (and set 'loop' for one that goes round):
//   npx vite-node -c vitest.config.ts scripts/learn-moves.ts -- <takes> --add
// Each entry: [numerals in the move shorthand, name, 'cadence' | 'loop'].
export const MINE_SPECS: [string, string, 'cadence' | 'loop'][] = [];

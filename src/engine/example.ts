import { applyAction } from './actions.ts'
import { LINE_COLORS } from './network.ts'
import { advanceGame, newGame } from './simulation.ts'
import type { GameState } from './types.ts'

export function exampleGame() {
  let game = { ...newGame('career'), funds: 34_000_000 }
  const update = (action: Parameters<typeof applyAction>[1]) => {
    const result = applyAction(game, action)
    if (result.error || !result.game) throw new Error('Invalid example network: ' + result.error)
    game = result.game
    return result.id!
  }
  const stops = [
    { x: 292, y: 409 }, { x: 520, y: 401 }, { x: 750, y: 510 },
    { x: 1080, y: 493 }, { x: 1283, y: 489 }, { x: 549, y: 169 },
    { x: 511, y: 612 }, { x: 301, y: 657 }, { x: 1134, y: 646 },
    { x: 957, y: 814 }, { x: 745, y: 268 },
  ].map((point) => update({ type: 'buildStation', point }))
  const patterns = [[0, 1, 2, 3, 4], [5, 1, 6, 7], [10, 2, 8, 9]]
  patterns.forEach((pattern, index) => {
    const id = update({
      type: 'saveLine', design: { name: '', stops: pattern.map((i) => stops[i]), color: LINE_COLORS[index], circular: false },
    })
    for (let i = 0; i < (index === 0 ? 3 : 2); i++) update({ type: 'buyTrain', id })
  })
  for (const index of [1, 2]) update({ type: 'interchange', id: stops[index] })
  game = advanceGame(game, 163)
  return game satisfies GameState
}

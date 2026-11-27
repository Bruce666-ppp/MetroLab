import { advanceGame } from './simulation.ts'
import type { GameState } from './types.ts'

self.addEventListener('message', (event: MessageEvent<{ game: GameState; minutes: number }>) => {
  self.postMessage(advanceGame(event.data.game, event.data.minutes))
})
self.postMessage('ready')

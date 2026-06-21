import { Puck, Goal } from './physics'

export interface TutorialStep {
  id: number
  instruction: string
  setup: (w: number, h: number, player: Puck) => {
    enemies?: Puck[]
    goals?: Goal[]
    playerStart?: { x: number; y: number }
  }
  objective: (gameState: TutorialGameState) => boolean
  nextStepDelay?: number // Delay before showing next instruction (ms)
}

export interface TutorialGameState {
  currentStep: number
  stepStartTime: number
  movementTime: number
  goalsCollected: number
  totalGoalsInStep: number
  hasShownInstruction: boolean
  instructionStartTime: number
  isDead: boolean
  stepCompleted: boolean
  isComplete: boolean
  hasShownBorderWarning: boolean
  showInstruction: boolean
  completionStartTime: number
}

export const tutorialSteps: TutorialStep[] = [
  {
    id: 1,
    instruction: "Use arrow keys or WASD to move. Your puck has momentum - it will continue moving after you release the keys. Practice for 15 seconds.",
    setup: (w: number, h: number, player: Puck) => ({
      enemies: [],
      goals: [],
      playerStart: { x: w / 2, y: h / 2 }
    }),
    objective: (state: TutorialGameState) => false, // Time-based, handled in game loop
    nextStepDelay: 500
  },
  {
    id: 2,
    instruction: "Collect the green orb by moving into it.",
    setup: (w: number, h: number, player: Puck) => ({
      enemies: [],
      goals: [{
        x: w / 2,
        y: h / 3,
        radius: 12,
        vx: 0,
        vy: 0
      }],
      playerStart: { x: w / 2, y: h * 0.7 }
    }),
    objective: (state: TutorialGameState) => state.goalsCollected >= 1,
    nextStepDelay: 500
  },
  {
    id: 3,
    instruction: "Collect all the green orbs.",
    setup: (w: number, h: number, player: Puck) => {
      const goals: Goal[] = []
      for (let i = 0; i < 4; i++) {
        goals.push({
          x: w * 0.2 + (w * 0.6 * i) / 3,
          y: h * 0.3 + Math.random() * h * 0.4,
          radius: 12,
          vx: 0,
          vy: 0
        })
      }
      return {
        enemies: [],
        goals,
        playerStart: { x: w / 2, y: h / 2 }
      }
    },
    objective: (state: TutorialGameState) => state.goalsCollected >= state.totalGoalsInStep,
    nextStepDelay: 500
  },
  {
    id: 4,
    instruction: "Follow the path and collect all orbs in a line.",
    setup: (w: number, h: number, player: Puck) => {
      const goals: Goal[] = []
      const startX = w * 0.2
      const y = h / 2
      for (let i = 0; i < 5; i++) {
        goals.push({
          x: startX + (w * 0.6 * i) / 4,
          y,
          radius: 12,
          vx: 0,
          vy: 0
        })
      }
      return {
        enemies: [],
        goals,
        playerStart: { x: w * 0.1, y: h / 2 }
      }
    },
    objective: (state: TutorialGameState) => state.goalsCollected >= state.totalGoalsInStep,
    nextStepDelay: 500
  },
  {
    id: 5,
    instruction: "Control your movement precisely to collect all orbs in the corners.",
    setup: (w: number, h: number, player: Puck) => {
      const margin = 80
      const goals: Goal[] = [
        { x: margin, y: margin, radius: 12, vx: 0, vy: 0 },
        { x: w - margin, y: margin, radius: 12, vx: 0, vy: 0 },
        { x: w - margin, y: h - margin, radius: 12, vx: 0, vy: 0 },
        { x: margin, y: h - margin, radius: 12, vx: 0, vy: 0 }
      ]
      return {
        enemies: [],
        goals,
        playerStart: { x: w / 2, y: h / 2 }
      }
    },
    objective: (state: TutorialGameState) => state.goalsCollected >= state.totalGoalsInStep,
    nextStepDelay: 500
  },
  {
    id: 6,
    instruction: "Avoid red enemies while collecting green orbs. If you die, you'll restart this step.",
    setup: (w: number, h: number, player: Puck) => {
      const goals: Goal[] = [
        { x: w * 0.3, y: h * 0.3, radius: 12, vx: 0, vy: 0 },
        { x: w * 0.7, y: h * 0.3, radius: 12, vx: 0, vy: 0 },
        { x: w * 0.5, y: h * 0.7, radius: 12, vx: 0, vy: 0 }
      ]
      
      const enemies: Puck[] = [
        {
          x: w * 0.2,
          y: h * 0.8,
          vx: 0,
          vy: -60, // Slow upward movement
          radius: 14,
          isPlayer: false,
          id: 'enemy-1'
        },
        {
          x: w * 0.8,
          y: h * 0.8,
          vx: 0,
          vy: -60, // Slow upward movement
          radius: 14,
          isPlayer: false,
          id: 'enemy-2'
        },
        {
          x: w * 0.5,
          y: h * 0.2,
          vx: 50,
          vy: 0, // Slow horizontal movement
          radius: 14,
          isPlayer: false,
          id: 'enemy-3'
        }
      ]
      
      return {
        enemies,
        goals,
        playerStart: { x: w / 2, y: h / 2 }
      }
    },
    objective: (state: TutorialGameState) => state.goalsCollected >= state.totalGoalsInStep,
    nextStepDelay: 500
  },
  {
    id: 7,
    instruction: "You're ready! Survive and collect as many orbs as you can.",
    setup: (w: number, h: number, player: Puck) => {
      const goals: Goal[] = []
      for (let i = 0; i < 3; i++) {
        goals.push({
          x: w * 0.2 + Math.random() * w * 0.6,
          y: h * 0.2 + Math.random() * h * 0.6,
          radius: 12,
          vx: 0,
          vy: 0
        })
      }
      
      const enemies: Puck[] = [
        {
          x: w * 0.1,
          y: h * 0.5,
          vx: 80, // Moderate speed
          vy: 0,
          radius: 14,
          isPlayer: false,
          id: 'enemy-1'
        },
        {
          x: w * 0.9,
          y: h * 0.5,
          vx: -80, // Moderate speed
          vy: 0,
          radius: 14,
          isPlayer: false,
          id: 'enemy-2'
        },
        {
          x: w * 0.5,
          y: h * 0.1,
          vx: 0,
          vy: 60, // Moderate speed
          radius: 14,
          isPlayer: false,
          id: 'enemy-3'
        },
        {
          x: w * 0.5,
          y: h * 0.9,
          vx: 0,
          vy: -60, // Moderate speed
          radius: 14,
          isPlayer: false,
          id: 'enemy-4'
        }
      ]
      
      return {
        enemies,
        goals,
        playerStart: { x: w / 2, y: h / 2 }
      }
    },
    objective: (state: TutorialGameState) => state.goalsCollected >= 5,
    nextStepDelay: 1000
  },
  {
    id: 8,
    instruction: "Congratulations! You have completed the tutorial. You can try out Survival Mode for the real challenge.",
    setup: (w: number, h: number, player: Puck) => ({
      enemies: [],
      goals: [],
      playerStart: { x: w / 2, y: h / 2 }
    }),
    objective: (state: TutorialGameState) => state.movementTime >= 3, // Show for 3 seconds then auto-advance
    nextStepDelay: 500
  }
]

export function createTutorialState(): TutorialGameState {
  return {
    currentStep: 0,
    stepStartTime: 0,
    movementTime: 0,
    goalsCollected: 0,
    totalGoalsInStep: 0,
    hasShownInstruction: false,
    instructionStartTime: 0,
    isDead: false,
    stepCompleted: false,
    isComplete: false,
    hasShownBorderWarning: false,
    showInstruction: false,
    completionStartTime: 0
  }
}

export function getCurrentTutorialStep(state: TutorialGameState): TutorialStep | undefined {
  return tutorialSteps[state.currentStep]
}

export function shouldShowInstruction(state: TutorialGameState): boolean {
  return !state.hasShownInstruction && state.currentStep < tutorialSteps.length
}

export function canProgressToNextStep(state: TutorialGameState): boolean {
  const currentStep = getCurrentTutorialStep(state)
  if (!currentStep) {
    console.log('canProgressToNextStep: no current step found')
    return false
  }
  
  const result = currentStep.objective(state)
  console.log(`canProgressToNextStep: objective result=${result}, goalsCollected=${state.goalsCollected}, movementTime=${state.movementTime}`)
  return result
}

export function advanceStep(state: TutorialGameState, onAdvance?: () => void): void {
  console.log(`advanceStep called: currentStep=${state.currentStep}, stepCompleted=${state.stepCompleted}, isComplete=${state.isComplete}`)
  
  if (state.stepCompleted || state.isComplete) {
    console.log('advanceStep blocked - step already completed or tutorial complete')
    return
  }

  state.stepCompleted = true
  console.log('stepCompleted set to true, starting timeout...')

  setTimeout(() => {
    console.log(`timeout executed: currentStep=${state.currentStep}, tutorialSteps.length=${tutorialSteps.length}`)
    if (state.currentStep >= tutorialSteps.length - 1) {
      // Tutorial complete (Step 8 completed - index 7)
      console.log('All steps completed, returning to menu')
      // Let Step 8 handle the menu return
    } else {
      // Advance to next step
      console.log('Advancing to next step')
      state.currentStep++
      state.stepStartTime = Date.now()
      state.movementTime = 0
      state.goalsCollected = 0
      state.totalGoalsInStep = 0
      state.hasShownInstruction = false
      state.instructionStartTime = 0
      state.isDead = false
      state.stepCompleted = false
      state.showInstruction = false
      console.log(`Advanced to step ${state.currentStep + 1}`)
    }
    console.log('Calling onAdvance callback')
    if (onAdvance) onAdvance()
  }, 500) // 500ms delay for UX
}

export function restartCurrentStep(state: TutorialGameState): TutorialGameState {
  return {
    ...state,
    stepStartTime: Date.now(),
    movementTime: 0,
    goalsCollected: 0,
    totalGoalsInStep: 0,
    hasShownInstruction: false,
    instructionStartTime: 0,
    isDead: false,
    stepCompleted: false,
    hasShownBorderWarning: state.hasShownBorderWarning, // Preserve border warning state
    showInstruction: false
  }
}

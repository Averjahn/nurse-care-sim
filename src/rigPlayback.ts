import { LoopOnce, LoopRepeat, type AnimationAction, type AnimationMixer, type AnimationMixerEventMap } from 'three'
import { animationPlan, animationTimeScale, CROSSFADE_SECONDS, POSE_CLIPS, type PatientPose, type PlaybackStep } from './patientAnimation.ts'

/** Receives Drei's mixer/actions. A new target cancels pending transitions. */
export class RigPlayback {
  mixer: AnimationMixer
  actions: Record<string, AnimationAction | null>
  pose: PatientPose
  current: AnimationAction | null = null
  queue: PlaybackStep[] = []
  stopped = false
  constructor(mixer: AnimationMixer, actions: Record<string, AnimationAction | null>, initial: PatientPose) {
    this.mixer = mixer; this.actions = actions; this.pose = initial
    mixer.addEventListener('finished', this.finished)
    this.play({ clip: POSE_CLIPS[initial], once: false }, false)
  }
  private finished = (event: AnimationMixerEventMap['finished']) => {
    if (event.action === this.current && !this.stopped) this.next()
  }
  private play(step: PlaybackStep, fade = true) {
    const next = this.actions[step.clip]
    if (!next) throw new Error(`Не найден клип ${step.clip}.`)
    const previous = this.current
    if (previous === next) { previous.stop(); this.current = null }
    next.reset().setLoop(step.once ? LoopOnce : LoopRepeat, step.once ? 1 : Infinity)
    next.clampWhenFinished = step.once
    next.setEffectiveTimeScale(1).setEffectiveWeight(1)
    if (fade && previous && previous !== next) { previous.fadeOut(CROSSFADE_SECONDS); next.fadeIn(CROSSFADE_SECONDS) }
    next.play(); this.current = next
  }
  private next() { const step = this.queue.shift(); if (step) this.play(step) }
  transition(target: PatientPose) {
    if (target === this.pose || this.stopped) return
    this.queue = animationPlan(this.pose, target, Object.keys(this.actions))
    this.pose = target
    this.next()
  }
  clock(speed: number, paused: boolean) { this.mixer.timeScale = animationTimeScale(speed, paused) }
  dispose() { this.stopped = true; this.queue = []; this.mixer.removeEventListener('finished', this.finished); this.mixer.stopAllAction() }
}

/** A second mixer isolates the short compression pulse from game-clock speed. */
export class CompressionPlayback {
  mixer: AnimationMixer
  action: AnimationAction
  lastCount: number
  constructor(mixer: AnimationMixer, action: AnimationAction, count: number) { this.mixer = mixer; this.action = action; this.lastCount = count }
  clock(paused: boolean) { this.mixer.timeScale = animationTimeScale(1, paused, true) }
  count(count: number) {
    if (count > this.lastCount) {
      this.action.reset().setLoop(LoopOnce, 1).setEffectiveWeight(1)
      this.action.clampWhenFinished = false
      this.action.play()
    }
    this.lastCount = count
  }
  dispose() { this.mixer.stopAllAction() }
}

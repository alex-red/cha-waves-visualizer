class SatelliteCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { startFrame, captureFrames } = options.processorOptions || {}
    const validStart = Number.isSafeInteger(startFrame) && startFrame >= 0
    const validLength = Number.isSafeInteger(captureFrames) && captureFrames > 0 && captureFrames <= 192000
    const validWindow = validStart && validLength && Number.isSafeInteger(startFrame + captureFrames)
    this.startFrame = validWindow ? startFrame : currentFrame
    this.captureFrames = validLength ? captureFrames : 0
    this.configurationError = validWindow ? '' : 'Invalid capture frame bounds.'
    this.samples = new Float32Array(this.captureFrames)
    this.presentInputFrames = 0
    this.missingInputFrames = 0
    this.unobservedFrames = 0
    this.presentZeroFrames = 0
    this.longestPresentZeroRunFrames = 0
    this.presentZeroRunFrames = 0
    this.coveredUntil = 0
    this.finished = false
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (output) for (const channel of output) channel.fill(0)

    if (!this.finished && this.configurationError) {
      this.finished = true
      this.port.postMessage({ type: 'error', message: this.configurationError })
      return true
    }

    if (!this.finished && this.captureFrames > 0) {
      const input = inputs[0] && inputs[0][0]
      const quantumFrames = output && output[0] && output[0].length > 0 ? output[0].length : 128
      const blockStart = currentFrame
      const blockEnd = blockStart + quantumFrames
      const captureEnd = this.startFrame + this.captureFrames
      const overlapStart = Math.max(blockStart, this.startFrame)
      const overlapEnd = Math.min(blockEnd, captureEnd)

      if (overlapEnd > overlapStart) {
        let frame = Math.max(overlapStart - this.startFrame, this.coveredUntil)
        const end = overlapEnd - this.startFrame
        if (frame > this.coveredUntil) {
          this.unobservedFrames += frame - this.coveredUntil
          this.coveredUntil = frame
          this.presentZeroRunFrames = 0
        }

        while (frame < end) {
          const sourceOffset = this.startFrame + frame - blockStart
          const hasInputFrame = Boolean(input) && sourceOffset < input.length
          if (!hasInputFrame) {
            this.missingInputFrames++
            this.presentZeroRunFrames = 0
          } else {
            const sample = input[sourceOffset]
            if (!Number.isFinite(sample)) {
              this.finished = true
              this.port.postMessage({ type: 'error', message: 'Microphone input contained a non-finite sample.' })
              return true
            }
            this.samples[frame] = sample
            this.presentInputFrames++
            if (sample === 0) {
              this.presentZeroFrames++
              this.presentZeroRunFrames++
              this.longestPresentZeroRunFrames = Math.max(this.longestPresentZeroRunFrames, this.presentZeroRunFrames)
            } else {
              this.presentZeroRunFrames = 0
            }
          }
          frame++
        }
        this.coveredUntil = Math.max(this.coveredUntil, end)
      }

      // A callback gap is unknown time, not missing microphone input. Preserve
      // its preallocated zeros and count it separately before advancing time.
      const callbackEndInCapture = Math.min(this.captureFrames, blockEnd - this.startFrame)
      if (callbackEndInCapture > this.coveredUntil) {
        this.unobservedFrames += callbackEndInCapture - this.coveredUntil
        this.coveredUntil = callbackEndInCapture
        this.presentZeroRunFrames = 0
      }

      if (blockEnd >= captureEnd) this.complete()
    }
    return true
  }

  complete() {
    if (this.finished) return
    if (this.coveredUntil < this.captureFrames) {
      this.unobservedFrames += this.captureFrames - this.coveredUntil
      this.coveredUntil = this.captureFrames
      this.presentZeroRunFrames = 0
    }
    const classifiedFrames = this.presentInputFrames + this.missingInputFrames + this.unobservedFrames
    if (classifiedFrames !== this.captureFrames || !Number.isSafeInteger(classifiedFrames)) {
      this.finished = true
      this.port.postMessage({ type: 'error', message: 'Invalid capture continuity counters.' })
      return
    }
    this.finished = true
    let peak = 0
    let sumSquares = 0
    let clipped = 0
    for (const sample of this.samples) {
      const magnitude = Math.abs(Number.isFinite(sample) ? sample : 0)
      peak = Math.max(peak, magnitude)
      sumSquares += magnitude * magnitude
      if (magnitude >= 0.999) clipped++
    }
    this.port.postMessage({
      type: 'complete',
      samples: this.samples.buffer,
      continuity: {
        status: 'observed',
        presentInputFrames: this.presentInputFrames,
        missingInputFrames: this.missingInputFrames,
        unobservedFrames: this.unobservedFrames,
        presentZeroFrames: this.presentZeroFrames,
        longestPresentZeroRunFrames: this.longestPresentZeroRunFrames,
      },
      signal: {
        peak: Math.min(1, peak),
        rms: Math.min(1, Math.sqrt(sumSquares / Math.max(1, this.samples.length))),
        clippedFraction: clipped / Math.max(1, this.samples.length),
      },
    }, [this.samples.buffer])
  }
}

registerProcessor('cha-waves-satellite-capture', SatelliteCaptureProcessor)

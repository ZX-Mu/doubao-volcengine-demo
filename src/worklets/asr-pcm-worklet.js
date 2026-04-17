class AsrPcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.inputSampleRate = sampleRate;
    this.frameBuffer = new Float32Array(0);
    this.targetFrameSize = 3200;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type !== 'config') return;
      if (typeof data.targetSampleRate === 'number') {
        this.targetSampleRate = data.targetSampleRate;
      }
      if (typeof data.inputSampleRate === 'number') {
        this.inputSampleRate = data.inputSampleRate;
      }
      if (typeof data.frameDurationMs === 'number' && data.frameDurationMs > 0) {
        this.targetFrameSize = Math.max(1600, Math.round((this.targetSampleRate * data.frameDurationMs) / 1000));
      }
      this.port.postMessage({
        type: 'debug',
        message: `input=${this.inputSampleRate}Hz target=${this.targetSampleRate}Hz frame=${this.targetFrameSize}`,
      });
    };
  }

  appendBuffer(existing, incoming) {
    const merged = new Float32Array(existing.length + incoming.length);
    merged.set(existing, 0);
    merged.set(incoming, existing.length);
    return merged;
  }

  downsample(input) {
    if (this.inputSampleRate === this.targetSampleRate) {
      return input;
    }

    const ratio = this.inputSampleRate / this.targetSampleRate;
    const outputLength = Math.floor(input.length / ratio);
    if (outputLength <= 0) {
      return new Float32Array(0);
    }

    const output = new Float32Array(outputLength);
    let outputIndex = 0;
    let inputIndex = 0;

    while (outputIndex < outputLength) {
      const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let i = Math.round(inputIndex); i < nextInputIndex; i += 1) {
        sum += input[i];
        count += 1;
      }
      output[outputIndex] = count > 0 ? sum / count : input[Math.round(inputIndex)] || 0;
      outputIndex += 1;
      inputIndex = nextInputIndex;
    }

    return output;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    const float32 = this.downsample(channel);
    if (float32.length === 0) {
      return true;
    }

    this.frameBuffer = this.appendBuffer(this.frameBuffer, float32);

    while (this.frameBuffer.length >= this.targetFrameSize) {
      const frame = this.frameBuffer.slice(0, this.targetFrameSize);
      this.frameBuffer = this.frameBuffer.slice(this.targetFrameSize);

      const pcm = new Int16Array(frame.length);
      for (let i = 0; i < frame.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, frame[i]));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor('asr-pcm-worklet', AsrPcmWorklet);

export interface SignalSender {
  clusterId: number;
  localX: number;
  localY: number;
}

export interface DigitalMessage extends SignalSender {
  channel: number;
  value: number;
}

export interface CompileMessage extends SignalSender {
  channel: number;
  payload: string;
}

export interface SerializedSignalBus {
  digitalNow: DigitalMessage[];
  digitalNext: DigitalMessage[];
  compileNow: CompileMessage[];
  compileNext: CompileMessage[];
}

const assertChannel = (channel: number): void => {
  if (!Number.isInteger(channel) || channel < 0 || channel > 255) throw new RangeError("信号频道必须为 0..255");
};

const senderCompare = (a: SignalSender, b: SignalSender): number =>
  a.localY - b.localY || a.localX - b.localX || a.clusterId - b.clusterId;

export class SignalBus {
  #digitalNow: DigitalMessage[] = [];
  #digitalNext: DigitalMessage[] = [];
  #compileNow: CompileMessage[] = [];
  #compileNext: CompileMessage[] = [];

  sendDigital(message: DigitalMessage): void {
    assertChannel(message.channel);
    if (!Number.isInteger(message.value) || message.value < -32768 || message.value > 32767) {
      throw new RangeError("数字信号必须为 int16");
    }
    this.#digitalNext.push({ ...message });
  }

  sendCompile(message: CompileMessage): void {
    assertChannel(message.channel);
    this.#compileNext.push({ ...message });
  }

  advanceTick(): void {
    this.#digitalNow = this.#digitalNext.sort(senderCompare);
    this.#compileNow = this.#compileNext.sort(senderCompare);
    this.#digitalNext = [];
    this.#compileNext = [];
  }

  readDigital(channel: number): number {
    assertChannel(channel);
    let total = 0n;
    for (const message of this.#digitalNow) if (message.channel === channel) total += BigInt(message.value);
    if (total > 32767n) return 32767;
    if (total < -32768n) return -32768;
    return Number(total);
  }

  readCompile(channel: number): readonly CompileMessage[] {
    assertChannel(channel);
    return this.#compileNow.filter((message) => message.channel === channel).map((message) => ({ ...message }));
  }

  exportState(): SerializedSignalBus {
    return {
      digitalNow: this.#digitalNow.map((message) => ({ ...message })),
      digitalNext: this.#digitalNext.map((message) => ({ ...message })),
      compileNow: this.#compileNow.map((message) => ({ ...message })),
      compileNext: this.#compileNext.map((message) => ({ ...message })),
    };
  }

  static fromState(state: SerializedSignalBus): SignalBus {
    const bus = new SignalBus();
    for (const message of state.digitalNow) {
      assertChannel(message.channel);
      bus.#digitalNow.push({ ...message });
    }
    for (const message of state.digitalNext) bus.sendDigital(message);
    for (const message of state.compileNow) {
      assertChannel(message.channel);
      bus.#compileNow.push({ ...message });
    }
    for (const message of state.compileNext) bus.sendCompile(message);
    bus.#digitalNow.sort(senderCompare);
    bus.#compileNow.sort(senderCompare);
    return bus;
  }
}

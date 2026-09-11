import { describe, expect, it } from "vitest";
import { SignalBus } from "./SignalBus";

describe("双信号总线", () => {
  it("消息延迟一 Tick 且数字和饱和到 int16", () => {
    const bus = new SignalBus();
    bus.sendDigital({ channel: 3, value: 30_000, clusterId: 1, localX: 1, localY: 1 });
    bus.sendDigital({ channel: 3, value: 30_000, clusterId: 2, localX: 1, localY: 1 });
    expect(bus.readDigital(3)).toBe(0);
    bus.advanceTick();
    expect(bus.readDigital(3)).toBe(32767);
  });

  it("编译片段按发送者局部坐标稳定排序", () => {
    const bus = new SignalBus();
    bus.sendCompile({ channel: 8, payload: "B", clusterId: 2, localX: 4, localY: 1 });
    bus.sendCompile({ channel: 8, payload: "A", clusterId: 9, localX: 2, localY: 1 });
    bus.advanceTick();
    expect(bus.readCompile(8).map((message) => message.payload)).toEqual(["A", "B"]);
  });
});

import { World, type SerializedWorldState } from "../engine/World";
import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import { createStoredZip, decodeUtf8, encodeUtf8, readStoredZip } from "./zipStore";

export const SCHEMA_VERSION = 1;
export const ENGINE_VERSION = "0.1.0";

interface Manifest {
  format: "ClusterCA";
  schemaVersion: number;
  engineVersion: string;
  width: number;
  height: number;
  chunkSize: number;
  topology: "torus";
  savedAt: string;
}

export const encodeProject = (world: World): Uint8Array => {
  const manifest: Manifest = {
    format: "ClusterCA",
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    chunkSize: CHUNK_SIZE,
    topology: "torus",
    savedAt: new Date().toISOString(),
  };
  return createStoredZip([
    { name: "manifest.json", data: encodeUtf8(JSON.stringify(manifest, null, 2)) },
    { name: "world/state.json", data: encodeUtf8(JSON.stringify(world.exportState())) },
  ]);
};

export const decodeProject = (bytes: Uint8Array): World => {
  const files = readStoredZip(bytes);
  const manifestBytes = files.get("manifest.json");
  const stateBytes = files.get("world/state.json");
  if (!manifestBytes || !stateBytes) throw new Error("项目缺少 manifest.json 或 world/state.json");
  const manifest = JSON.parse(decodeUtf8(manifestBytes)) as Manifest;
  if (manifest.format !== "ClusterCA") throw new Error("文件不是 ClusterCA 项目");
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`不支持 schemaVersion ${manifest.schemaVersion}`);
  if (
    manifest.width !== WORLD_WIDTH ||
    manifest.height !== WORLD_HEIGHT ||
    manifest.chunkSize !== CHUNK_SIZE ||
    manifest.topology !== "torus"
  ) {
    throw new Error("项目世界规格与当前引擎不兼容");
  }
  const state = JSON.parse(decodeUtf8(stateBytes)) as SerializedWorldState;
  return World.fromState(state);
};

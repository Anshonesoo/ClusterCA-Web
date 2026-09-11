import type { ToroidalRect, WorldSnapshot } from "../model/types";
import type { DeclarativeRule } from "../extensions/DeclarativeRule";
import type { OrganelleKind } from "../model/organelles";

export type WorkerCommand =
  | { type: "initialize"; seed: string }
  | { type: "new-project"; template: "blank" | "ecology" | "custom" | "developer" | "teach"; seed: string }
  | { type: "run" }
  | { type: "pause" }
  | { type: "step" }
  | { type: "set-rate"; ticksPerSecond: number }
  | { type: "add-cluster"; rect: ToroidalRect }
  | { type: "remove-cluster"; clusterId: number }
  | { type: "set-cluster-note"; clusterId: number; note: string }
  | { type: "add-template-seed"; geneHex: string; x: number; y: number }
  | { type: "set-material"; x: number; y: number; amount: string; energy: string }
  | {
      type: "set-organelle";
      clusterId: number;
      localX: number;
      localY: number;
      code: number;
      direction?: "up" | "right" | "down" | "left";
      channel?: number;
      inputChannel?: number;
      value?: number;
      force?: number;
      operation?: string;
      mode?: string;
      range?: number;
    }
  | {
      type: "register-custom-organelle";
      definition: {
        code: number;
        kind: OrganelleKind;
        name: string;
        color: string;
        buildAmount: string;
        buildEnergy: string;
        recycleNumerator: string;
        recycleDenominator: string;
        ruleId: string;
      };
      rule: DeclarativeRule;
    }
  | { type: "export-project"; purpose: "download" | "autosave" }
  | { type: "import-project"; bytes: Uint8Array }
  | { type: "undo-edit" }
  | { type: "redo-edit" }
  | { type: "export-metrics" }
  | { type: "export-selection"; clusterId: number }
  | { type: "trust-project-scripts" }
  | { type: "request-snapshot" };

export type WorkerEvent =
  | { type: "ready"; snapshot: WorldSnapshot }
  | { type: "snapshot"; snapshot: WorldSnapshot }
  | { type: "project-data"; bytes: Uint8Array; fileName: string; purpose: "download" | "autosave"; snapshot: WorldSnapshot }
  | { type: "export-data"; bytes: Uint8Array; fileName: string; mimeType: string; snapshot: WorldSnapshot }
  | { type: "trust-required"; scriptIds: string[]; snapshot: WorldSnapshot }
  | { type: "scripts-trusted"; scriptIds: string[]; snapshot: WorldSnapshot }
  | { type: "error"; message: string; snapshot: WorldSnapshot };

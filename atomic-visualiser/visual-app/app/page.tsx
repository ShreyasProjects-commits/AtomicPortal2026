"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type CSSProperties } from "react";
import { mockCaseOrder, mockCases, type MockCaseId } from "./data/mockData";
import type { OptimisationResult } from "./lib/types";

const Visualizer3D = dynamic(
  () => import("./components/Visualizer3D").then((m) => m.Visualizer3D),
  { ssr: false }
);

export default function VisualizerPage() {
  const [activeCase, setActiveCase] = useState<MockCaseId>("case1");
  const [liveResult, setLiveResult] = useState<OptimisationResult | null>(null);
  const activeScenario = mockCases[activeCase];

  type OrderResultPayload = {
    orderId?: string;
    packedContainers?: Array<{
      containerId?: string;
      utilisation?: number;
      placements?: Array<{
        itemId: string;
        position: { x: number; y: number; z: number; unit?: string };
        rotation?: { x: number; y: number; z: number };
      }>;
    }>;
    unpackedItems?: Array<{ id: string; reason?: string }>;
    items?: Array<{
      id: string;
      name?: string;
      dimensions?: { length: number; width: number; height: number; unit?: string };
      weight?: { value: number; unit?: string };
    }>;
    containers?: Array<{
      id: string;
      name?: string;
      dimensions?: { length: number; width: number; height: number; unit?: string };
      maxWeight?: { value: number; unit?: string };
    }>;
  };

  const toMm = (value: number, unit?: string) => (unit === "cm" ? value * 10 : value);

  const convertPayload = (payload: OrderResultPayload): OptimisationResult | null => {
    if (!Array.isArray(payload.packedContainers) || !Array.isArray(payload.items) || !Array.isArray(payload.containers)) {
      return null;
    }

    const itemById = new Map(payload.items.map((item) => [item.id, item]));
    const containerById = new Map(payload.containers.map((container) => [container.id, container]));

    const placements = payload.packedContainers.flatMap((packedContainer, boxIndex) => {
      const container = packedContainer.containerId ? containerById.get(packedContainer.containerId) : undefined;

      return (packedContainer.placements ?? []).flatMap((placement) => {
        const item = itemById.get(placement.itemId);
        if (!item?.dimensions) {
          return [];
        }

        return [{
          boxInstance: boxIndex + 1,
          boxReference: container?.name ?? container?.id ?? `Carton ${boxIndex + 1}`,
          itemCode: item.name ?? item.id,
          placedDimension: {
            length: toMm(item.dimensions.length, item.dimensions.unit),
            width: toMm(item.dimensions.width, item.dimensions.unit),
            depth: toMm(item.dimensions.height, item.dimensions.unit),
          },
          position: {
            x: toMm(placement.position.x, placement.position.unit),
            y: toMm(placement.position.y, placement.position.unit),
            z: toMm(placement.position.z, placement.position.unit),
          },
        }];
      });
    });

    const usedBoxes = payload.packedContainers.flatMap((packedContainer, boxIndex) => {
      const container = packedContainer.containerId ? containerById.get(packedContainer.containerId) : undefined;
      if (!container?.dimensions) {
        return [];
      }

      const totalWeight = (packedContainer.placements ?? []).reduce((sum, placement) => {
        const item = itemById.get(placement.itemId);
        return sum + (item?.weight?.value ?? 0);
      }, 0);

      return [{
        boxInstance: boxIndex + 1,
        boxReference: container?.name ?? container?.id ?? `Carton ${boxIndex + 1}`,
        totalWeight,
        dimension: {
          length: toMm(container.dimensions.length, container.dimensions.unit),
          width: toMm(container.dimensions.width, container.dimensions.unit),
          depth: toMm(container.dimensions.height, container.dimensions.unit),
        },
      }];
    });

    return {
      placements,
      usedBoxes,
      unplacedItems: payload.unpackedItems ?? [],
    };
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const isLocalDev =
        event.origin.startsWith("http://localhost") || event.origin.startsWith("http://127.0.0.1");
      const isAllowedProductionOrigin = event.origin === "https://atomic-portal2026.vercel.app";

      if (!isLocalDev && !isAllowedProductionOrigin) return;

      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "viz-data") return;

      console.log("visual-app received message", { origin: event.origin, data });

      const payload = data.payload as OrderResultPayload;
      const converted = convertPayload(payload);
      if (converted) {
        console.log("visual-app converted payload to OptimisationResult", converted);
        setLiveResult(converted);
      } else {
        console.warn("visual-app could not convert payload", payload);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const result = liveResult ?? activeScenario.output;

  return (
    <main style={styles.page}>
      <div style={styles.overlay}>
        <div>
          <div style={styles.kicker}>{liveResult ? "Live data" : "Mock data"}</div>
          <div style={styles.title}>{liveResult ? "Received visualiser payload" : activeScenario.label}</div>
          <div style={styles.description}>
            {liveResult
              ? "This scene is driven by data sent from the parent page."
              : activeScenario.description}
          </div>
          {liveResult && <div style={styles.debugLine}>Listening for parent messages from localhost.</div>}
        </div>

        <div style={styles.caseSwitcher}>
          {mockCaseOrder.map((caseId) => {
            const scenario = mockCases[caseId];
            const isActive = caseId === activeCase;

            return (
              <button
                key={caseId}
                type="button"
                onClick={() => {
                  setLiveResult(null);
                  setActiveCase(caseId);
                }}
                style={{
                  ...styles.caseButton,
                  ...(isActive ? styles.caseButtonActive : {}),
                }}
              >
                <span style={styles.caseButtonLabel}>{scenario.label}</span>
                <span style={styles.caseButtonMeta}>
                  {scenario.output.placements.length} placements
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Visualizer3D result={result} />
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    width: "100vw",
    height: "100dvh",
    position: "relative",
    overflow: "hidden",
    background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
  },
  overlay: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    zIndex: 10,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 16px",
    borderRadius: 18,
    background: "rgba(15, 23, 42, 0.84)",
    backdropFilter: "blur(16px)",
    boxShadow: "0 18px 50px rgba(15, 23, 42, 0.22)",
    color: "#F8FAFC",
  },
  kicker: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "#93C5FD",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  description: {
    fontSize: 13,
    lineHeight: 1.45,
    color: "#CBD5E1",
    marginTop: 4,
    maxWidth: 420,
  },
  debugLine: {
    marginTop: 8,
    fontSize: 12,
    color: "#7DD3FC",
  },
  caseSwitcher: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  caseButton: {
    border: "1px solid rgba(148, 163, 184, 0.28)",
    background: "rgba(255, 255, 255, 0.08)",
    color: "#E2E8F0",
    borderRadius: 14,
    padding: "10px 14px",
    minWidth: 132,
    textAlign: "left",
    cursor: "pointer",
    transition: "transform 120ms ease, background 120ms ease, border-color 120ms ease",
  },
  caseButtonActive: {
    background: "linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(14, 165, 233, 0.95))",
    borderColor: "rgba(125, 211, 252, 0.95)",
    color: "#FFFFFF",
    transform: "translateY(-1px)",
  },
  caseButtonLabel: {
    display: "block",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  caseButtonMeta: {
    display: "block",
    marginTop: 4,
    fontSize: 12,
    opacity: 0.82,
  },
};

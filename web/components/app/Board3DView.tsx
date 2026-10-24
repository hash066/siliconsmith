"use client";

import { useMemo } from "react";
import { boardMesh } from "@/lib/board3d";
import type { BoardGeometry } from "@/lib/layout";
import { MeshCanvas } from "../domain/StlViewer";

/** The routed board in 3D: substrate, copper pads and the parts as boxes. Approximate, and says so. */
export function Board3DView({ geom }: { geom: BoardGeometry }) {
  const b = useMemo(() => boardMesh(geom), [geom]);
  const colorOf = useMemo(() => (tri: number) => b.colours[tri] ?? [120, 120, 120], [b]);
  return (
    <div className="min-w-0" data-testid="board-3d">
      <MeshCanvas mesh={b.mesh} colorOf={colorOf} zScale={3} label={`Routed board in 3D: ${b.parts} parts on a ${geom.width} by ${geom.height} millimetre board. Drag to rotate.`} footer={<span className="num ml-auto">{b.parts} parts · {geom.width} × {geom.height} mm · height exaggerated</span>} />
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3" aria-label="Legend">
        {[
          ["Board", "rgb(28,122,78)"],
          ["Copper pads", "rgb(214,178,90)"],
          ["Chips and sensor", "rgb(30,30,34)"],
          ["Modules and connectors", "rgb(190,196,204)"],
          ["Capacitors", "rgb(166,126,84)"],
        ].map(([n, c]) => (
          <li key={n} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
            {n}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">Approximate: each part is a box over its footprint at a typical height, not a model of the real package. Drag to rotate.</p>
    </div>
  );
}

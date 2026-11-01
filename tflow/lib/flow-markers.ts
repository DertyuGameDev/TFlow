import type { FlowPlacement } from "./flow-layout";

export const FLOW_MARKER_HEIGHT = 32;
export const FLOW_SHORT_SLOT_HEIGHT = 44;
const MARKER_SPACING = FLOW_MARKER_HEIGHT + 8;

export type FlowMarker = {
  id: string;
  items: FlowPlacement[];
  left: number;
  right: number;
  first: number;
  last: number;
  top: number;
};

/** Pack labels, not time intervals: the actual schedule geometry stays exact. */
export function flowMarkers(placements: FlowPlacement[]): FlowMarker[] {
  let groups: FlowMarker[] = [];
  for (const item of [...placements].sort((a, b) => a.top - b.top)) {
    if (item.height >= FLOW_SHORT_SLOT_HEIGHT) continue;
    const center = item.top + item.height / 2;
    const left = item.lane / item.lanes;
    const right = (item.lane + item.span) / item.lanes;
    const nearby = groups.filter(
      (group) =>
        center - group.last < MARKER_SPACING &&
        left === group.left &&
        right === group.right,
    );
    const items = [...nearby.flatMap((group) => group.items), item].sort(
      (a, b) => a.top - b.top || a.activity.id.localeCompare(b.activity.id),
    );
    const first = Math.min(center, ...nearby.map((group) => group.first));
    groups = groups.filter((group) => !nearby.includes(group));
    groups.push({
      id: `short:${items[0].activity.id}`,
      items,
      left: Math.min(left, ...nearby.map((group) => group.left)),
      right: Math.max(right, ...nearby.map((group) => group.right)),
      first,
      last: center,
      top: (first + center - FLOW_MARKER_HEIGHT) / 2,
    });
  }
  return groups;
}

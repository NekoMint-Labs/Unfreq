import type { MySignalSummary, SignalFrequencyProfile } from "@unfreq/contracts";

export type SignalTreeNode = {
  children: SignalTreeNode[];
  missingParentId?: string;
  signal?: MySignalSummary;
};

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatCreatedParts(value: string): { monthDay: string; year: string } {
  const date = new Date(value);

  return {
    monthDay: date.toLocaleDateString("zh-CN", {
      day: "2-digit",
      month: "2-digit",
    }),
    year: date.getFullYear().toString(),
  };
}

export function toExpandedSummary(value: string): string {
  return value.length > 92 ? `${value.slice(0, 92)}...` : value;
}

export function getTopFrequencyProfiles(
  signals: MySignalSummary[],
): SignalFrequencyProfile[] {
  const countByBand = new Map<string, { count: number; profile: SignalFrequencyProfile }>();

  for (const signal of signals) {
    const current = countByBand.get(signal.frequencyProfile.primaryBand);

    countByBand.set(signal.frequencyProfile.primaryBand, {
      count: (current?.count ?? 0) + 1,
      profile: current?.profile ?? signal.frequencyProfile,
    });
  }

  return Array.from(countByBand.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.profile.displayText.localeCompare(right.profile.displayText, "zh-CN");
    })
    .slice(0, 3)
    .map((item) => item.profile);
}

function getTreeNodeTime(node: SignalTreeNode): number {
  if (node.signal !== undefined) {
    return new Date(node.signal.createdAt).getTime();
  }

  return Math.max(...node.children.map(getTreeNodeTime));
}

function sortSignalTree(node: SignalTreeNode): SignalTreeNode {
  node.children.sort((left, right) => getTreeNodeTime(left) - getTreeNodeTime(right));
  node.children.forEach(sortSignalTree);

  return node;
}

export function buildSignalTree(signals: MySignalSummary[]): SignalTreeNode[] {
  const nodeById = new Map<string, SignalTreeNode>();
  const roots: SignalTreeNode[] = [];
  const missingParentRootById = new Map<string, SignalTreeNode>();

  signals.forEach((signal) => {
    nodeById.set(signal.id, {
      children: [],
      signal,
    });
  });

  signals.forEach((signal) => {
    const node = nodeById.get(signal.id);

    if (node === undefined) {
      return;
    }

    if (signal.parentSignalId === undefined) {
      roots.push(node);
      return;
    }

    const parentNode = nodeById.get(signal.parentSignalId);

    if (parentNode !== undefined) {
      parentNode.children.push(node);
      return;
    }

    const missingParentNode = missingParentRootById.get(signal.parentSignalId) ?? {
      children: [],
      missingParentId: signal.parentSignalId,
    };

    if (!missingParentRootById.has(signal.parentSignalId)) {
      missingParentRootById.set(signal.parentSignalId, missingParentNode);
      roots.push(missingParentNode);
    }

    missingParentNode.children.push(node);
  });

  return roots
    .filter((node) => node.children.length > 0)
    .map(sortSignalTree)
    .sort((left, right) => getTreeNodeTime(right) - getTreeNodeTime(left));
}

export function parseOnboardingMode(
  value?: string,
): "complete" | "login" | "registered" | undefined {
  if (value === "complete" || value === "login" || value === "registered") {
    return value;
  }

  return undefined;
}

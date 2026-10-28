import Link from "next/link";
import type { MySignalSummary } from "@unfreq/contracts";
import {
  buildSignalTree,
  formatDateTime,
  type SignalTreeNode,
} from "./my-frequency-utils";
import { SignalKindBadge } from "./SignalKindBadge";

function SignalTreeItem({ node }: { node: SignalTreeNode }) {
  if (node.signal === undefined) {
    return (
      <div className="grid gap-3 border-l border-[color:var(--border-default)] pl-4">
        <div className="my-frequency-thought-card grid gap-1">
          <span className="font-mono text-[10px] tracking-[0.12em] text-[color:var(--text-secondary)]">
            上层信号暂不可见
          </span>
          <span className="break-all text-xs leading-5 text-[color:var(--text-tertiary)]">
            {node.missingParentId}
          </span>
        </div>
        <div className="grid gap-3">
          {node.children.map((child) => (
            <SignalTreeItem key={child.signal?.id ?? child.missingParentId} node={child} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 border-l border-[color:var(--border-subtle)] pl-4">
      <Link
        className="my-frequency-thought-card grid gap-2"
        href={`/result/${node.signal.id}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SignalKindBadge isExtended={node.signal.parentSignalId !== undefined} />
          <time
            className="font-mono text-[10px] text-[color:var(--text-tertiary)]"
            dateTime={node.signal.createdAt}
          >
            {formatDateTime(node.signal.createdAt)}
          </time>
        </div>
        <span className="text-sm leading-6 text-[color:var(--text-secondary)]">
          {node.signal.seedText}
        </span>
      </Link>
      {node.children.length > 0 ? (
        <div className="grid gap-3">
          {node.children.map((child) => (
            <SignalTreeItem key={child.signal?.id ?? child.missingParentId} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SignalThoughtTree({ signals }: { signals: MySignalSummary[] }) {
  const tree = buildSignalTree(signals);

  if (tree.length === 0) {
    return null;
  }

  return (
    <section className="my-frequency-section grid gap-4 p-5 lg:col-start-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="radio-kicker">THOUGHT TREE</p>
          <h2 className="my-frequency-section-title">想法树</h2>
        </div>
        <span className="text-xs text-[color:var(--text-tertiary)]">
          只显示已延伸的分支
        </span>
      </div>
      <div className="grid gap-4">
        {tree.map((node) => (
          <SignalTreeItem key={node.signal?.id ?? node.missingParentId} node={node} />
        ))}
      </div>
    </section>
  );
}

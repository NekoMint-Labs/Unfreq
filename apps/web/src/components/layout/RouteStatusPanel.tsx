import type { ReactNode } from "react";

type RouteStatusPanelMetric = {
  label: string;
  value: string;
};

type RouteStatusPanelProps = {
  body: string;
  children?: ReactNode;
  kicker: string;
  metrics?: RouteStatusPanelMetric[];
  title: string;
};

export function RouteStatusPanel({
  body,
  children,
  kicker,
  metrics,
  title,
}: RouteStatusPanelProps) {
  return (
    <section className="route-status-panel">
      <div className="route-status-card">
        <p className="radio-kicker">{kicker}</p>
        <h1 className="route-status-title">{title}</h1>
        <p className="route-status-body">{body}</p>
        {children ? (
          <div className="route-status-actions">{children}</div>
        ) : null}
      </div>

      {metrics === undefined || metrics.length === 0 ? null : (
        <dl className="stat-grid text-sm">
          {metrics.map((metric) => (
            <div className="stat-cell" key={metric.label}>
              <dt className="stat-label">{metric.label}</dt>
              <dd className="stat-value text-lg">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

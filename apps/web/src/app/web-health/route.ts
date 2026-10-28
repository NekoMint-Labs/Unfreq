import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type WebHealthData = {
  service: "web";
  status: "ok";
  timestamp: string;
  uptimeSeconds: number;
};

export function GET() {
  const data: WebHealthData = {
    service: "web",
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };

  return NextResponse.json(data);
}

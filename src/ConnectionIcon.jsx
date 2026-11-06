import React from "react";
import { FileText, Tablet, Mic } from "lucide-react";
export function ConnectionIcon({ name }) {
  const Icon = { markdown: FileText, paper: Tablet, voice: Mic }[name];
  return Icon ? (
    <Icon size={25} strokeWidth={1.5} aria-hidden="true" />
  ) : (
    <img
      className="connection-brand"
      src={`./brands/${name}.png`}
      alt=""
      width="40"
      height="40"
    />
  );
}

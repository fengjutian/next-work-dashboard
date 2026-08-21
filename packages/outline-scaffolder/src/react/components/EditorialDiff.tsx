import React from "react";
import { compactTextDiff } from "../../core/outline";

export interface EditorialDiffProps {
  original: string;
  replacement: string;
}

export const EditorialDiff: React.FC<EditorialDiffProps> = ({ original, replacement }) => {
  const diff = compactTextDiff(original, replacement);
  return (
    <div className="mt-2 grid gap-2 text-[11px] md:grid-cols-2">
      <div className="rounded border border-red-500/20 bg-red-500/[0.06] p-2">
        <div className="mb-1 font-medium text-red-700">原文</div>
        {diff.prefix}<del className="bg-red-500/20">{diff.removed}</del>{diff.suffix}
      </div>
      <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.06] p-2">
        <div className="mb-1 font-medium text-emerald-700">建议稿</div>
        {diff.prefix}<ins className="bg-emerald-500/20 no-underline">{diff.added}</ins>{diff.suffix}
      </div>
    </div>
  );
};

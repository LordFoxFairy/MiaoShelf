"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { normalizeTags } from "@/lib/tags";

type Operation = "add" | "remove" | "replace";

const OPERATIONS: Array<{ value: Operation; label: string; hint: string }> = [
  { value: "add", label: "添加", hint: "保留已有标签，追加新的" },
  { value: "remove", label: "移除", hint: "只删指定标签，其余不动" },
  { value: "replace", label: "替换", hint: "清空已有标签，改成新的" },
];

export function BulkTagDialog({
  open,
  onOpenChange,
  count,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onSubmit: (operation: Operation, tags: string[]) => void;
}) {
  const [operation, setOperation] = useState<Operation>("add");
  const [input, setInput] = useState("");

  const preview = normalizeTags(input);

  const handleSubmit = () => {
    onSubmit(operation, preview);
    setInput("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>批量打标签</DialogTitle>
          <DialogDescription>
            将对选中的 {count} 个商品生效。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>操作方式</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {OPERATIONS.map((op) => (
                <button
                  key={op.value}
                  type="button"
                  onClick={() => setOperation(op.value)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-center transition-colors",
                    operation === op.value
                      ? "border-primary/50 bg-accent text-accent-foreground"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="block text-xs font-medium">{op.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {OPERATIONS.find((op) => op.value === operation)?.hint}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">标签</Label>
            <Input
              id="tags"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="质保, 官方, 美区"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              用逗号分隔，单个最多 20 字，每个商品最多 12 个标签。
            </p>
          </div>

          {preview.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {preview.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={preview.length === 0 && operation !== "replace"}
          >
            应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import type { LucideIcon } from "lucide-react";

/**
 * Generic "coming soon" page body used by Checkpoint-3 route placeholders.
 * Each real page (Checkpoints 5–7) replaces its file's body; the routing,
 * shell, and role guards are already in place.
 */
export function PagePlaceholder({
  icon: Icon,
  title,
  description,
  checkpoint,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  checkpoint: string;
}) {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-xl place-items-center text-center">
      <div>
        <div className="mx-auto grid size-14 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-7" />
        </div>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <span className="mt-4 inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          Arrives in {checkpoint}
        </span>
      </div>
    </div>
  );
}

import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";

/** Consistent inline error + retry used by data pages. */
export function PageError({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <AlertTriangle className="mx-auto size-8 text-destructive" />
      <p className="mt-3 font-medium">Couldn't load this data</p>
      <p className="mt-1 text-sm text-muted-foreground">The request failed. Please try again.</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 text-sm text-primary hover:underline">
          Retry
        </button>
      )}
    </Card>
  );
}

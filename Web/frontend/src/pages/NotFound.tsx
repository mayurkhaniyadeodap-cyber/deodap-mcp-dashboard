import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <div className="text-6xl font-semibold tracking-tight text-primary">404</div>
        <p className="mt-2 text-muted-foreground">This page doesn't exist.</p>
        <Link to="/dashboard" className={buttonVariants({ className: "mt-6" })}>
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}

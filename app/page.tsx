import { Button } from "@/components/ui/button";

/**
 * Placeholder root route. The application shell and the real screens arrive in
 * Story 1.3; this exists only so the design-system foundation has somewhere to
 * render — every value below comes from a token, none from a literal.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-heading text-3xl font-medium tracking-tight">
          Aira
        </h1>
        <p className="text-muted-foreground max-w-md text-sm">
          HRIS dan payroll sederhana untuk usaha kecil dan menengah di
          Indonesia.
        </p>
      </div>
      <Button variant="outline">Mulai</Button>
    </main>
  );
}

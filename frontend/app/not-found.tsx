import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <Link href="/" className={buttonVariants({ variant: "primary" })}>
        Back home
      </Link>
    </div>
  );
}

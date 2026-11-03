import { redirect } from "next/navigation";

/** The failure test is an internal testing tool (Settings > Testing tools), not a normal feature. */
export default function DemoPage() {
  redirect("/assess?test=make-it-fail");
}
